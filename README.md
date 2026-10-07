# SwingLab

A swing lab for a 3D-printed VR cricket bat. A Meta Quest 3 controller is mounted in a printed bat; SwingLab reads the controller pose every frame, finds each swing, measures it, and rates each shot against a virtual bowling machine. It is a static site (no build step, no server) built with three.js and the WebXR API.

**Status.** All logic is tested in Node on synthetic swings, and the full headset path (calibration, stance, ten-ball drill) is tested with a mocked WebXR frame stream placed at an arbitrary spot and heading in a room. It has **not yet been run on a real Quest 3**. Step 1 below is a two-minute device check that settles the main unknowns before you rely on any number.

## Try it

```
python3 -m http.server 8000      # then open http://localhost:8000
```

- **Drill > Run the simulator** runs the whole drill with a scripted batter (no headset). Everything it produces is labelled synthetic.
- **Review** opens the bundled synthetic sample session, any session saved in this browser, or a session file you open.

## On the headset

The Quest Browser needs an HTTPS page. Publish the repo with GitHub Pages (Settings > Pages > Deploy from branch > `main` / root), then on the Quest open `https://<you>.github.io/swinglab/`.

1. **Device check first.** Open `xr-check.html`. It confirms WebXR and immersive VR work, measures how often each controller reports a pose, and measures pose jitter while the bat is held still. Copy the results.
2. **Enter VR** on the main page, then follow the three calibration steps on the panel in front of you:
   1. Pull the trigger on the controller that is *not* on the bat. Rest the toe on the floor, pull the trigger again, and swirl the handle in wide circles for 6 seconds. This finds the bat tip (pivot calibration).
   2. Take your stance facing the bowler, blade facing the bowler, pull the trigger and hold still for 3 seconds. This sets the blade-face direction and the bowling line.
   3. Ten balls follow. After the set the panel shows your average rating, bat speed and repeatability, and the session is saved in the browser. Pull the free trigger for another set.
3. Back on the page, **Review** shows the 3D replay and charts, and **Download** saves the session as JSON.

## How it works

| Module | Job |
|---|---|
| `src/calibration.js` | Pivot calibration (linear least squares for the tip offset, with outlier trimming) and stance calibration (blade-face direction). |
| `src/swing.js` | Tip series, swing segmentation, metrics (peak speed, plane tilt, path, backlift, timing) and session consistency. |
| `src/drill.js` | Bowling-machine planner, ball physics, swept ball-vs-blade contact test, outcome model, 0-100 shot rating. |
| `src/drillcore.js` | The drill controller. One pose per frame in; events and results out. No rendering code. |
| `src/simbatter.js`, `src/synth.js` | Scripted batter and sensor-noise model for the simulator, tests and the sample session. |
| `src/main.js`, `src/scene.js`, `src/hud.js` | three.js scene, WebXR session handling and the heads-up panel. |
| `src/review.js` | Session review: 3D replay, speed chart, tables. |

Coordinates: the *drill frame* has its origin on the floor under your head when you set your stance, +Y up, the bowler along -Z, +X to your right. Poses from the headset are converted into it.

### Metrics

- **Peak bat speed** from frame-to-frame tip movement. At 72 Hz it reads a few percent under the true instantaneous peak.
- **Swing plane tilt**: angle of the best-fit plane through the downswing from vertical (0 = vertical). Plane deviation is the RMS distance from that plane.
- **Swing path**: direction of the bat through the hitting zone, degrees right (+) or left (-) of the line to the bowler.
- **Backlift height**: highest the tip gets in the 0.7 s before peak speed.
- **Timing**: when the tip crosses the hitting plane minus when the ball does. Negative = early.
- **Repeatability**: `100 / (1 + mean(sd_i / tolerance_i))` over the five metrics, with tolerances 1.5 m/s, 6 deg, 6 deg, 0.10 m and 40 ms.

### Shot rating

`100 x (0.45 contact + 0.30 power + 0.25 control)`. Contact is how near the sweet spot (18 cm from the toe) and how central across the blade; power is exit speed over 38 m/s; control is direction within about 40 degrees of straight and kept low. The weights are a judgement.

## Tests

```
bash tests/run_tests.sh
```

Runs 15 Node tests (math, calibration recovery to a few millimetres, metrics against noiseless ground truth, delivery planner, contact and rating, reproducible simulated session) and the mocked-headset flow test (needs Python with Playwright). Regenerate the synthetic sample with `node tools/make_sample.mjs`.

## Session file

`{ format: "swinglab-session", version: 1, synthetic, calibration: {tip_local, face_local, rms_mm, length_m}, swings: [ { n, label, rating, metrics, shot, frames: [[t, px,py,pz, qx,qy,qz,qw], ...], ball_path: [[t, x,y,z], ...] } ] }`

## Limits

- Tracking is the Quest 3's, good but not a laboratory instrument; the device check measures it.
- The ball is virtual and the physics is deliberately simple (no spin or swing).
- Only one immersive app runs on a Quest at a time, and iB Cricket does not export swing data, so SwingLab is its own scene.
- No account, no server, no analytics. Sessions leave the browser only when you press Download.

Licence: MIT for this code. `vendor/` holds three.js (MIT, see `vendor/THREE_LICENSE`).
