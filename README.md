# SwingLab: a swing lab for a 3D-printed VR cricket bat

**Live demo:** https://manimod7.github.io/swinglab/ · **Source:** https://github.com/manimod7/swinglab · **Portfolio:** https://manimod7.github.io/

A Meta Quest 3 controller is mounted in a 3D-printed cricket bat. SwingLab reads the controller pose every frame, finds each swing, measures it, and rates each shot against a virtual bowling machine. It is a static site (no build step, no server, no account) built with three.js and the WebXR API.

> **Honest status.** All logic is tested in Node on synthetic swings, and the full headset path (calibration, stance, ten-ball drill) is tested with a mocked WebXR frame stream. It has **not yet been validated on a real Quest 3.** Run the two-minute device check (`xr-check.html`) before trusting any number from a headset.

---

## Contents

1. [What it is](#what-it-is) · 2. [Why I built it](#why-i-built-it) · 3. [Try it without a headset](#try-it-without-a-headset) · 4. [On the headset](#on-the-headset) · 5. [Hardware](#hardware) · 6. [How it works](#how-it-works) · 7. [Metrics](#metrics) · 8. [Shot rating](#shot-rating) · 9. [Tests](#tests) · 10. [Session file](#session-file) · 11. [FAQ](#faq) · 12. [Limits](#limits) · 13. [Licence](#licence)

## What it is

- **Calibrate** in under a minute: the app finds the bat's pivot point (the tip) and your stance.
- **Drill:** ten bowled balls per set. Each swing gets a contact result and a 0 to 100 rating.
- **Review:** 3D replay of every swing, speed chart and tables. Download the session as JSON.
- **Simulator:** a scripted batter runs the same drill in any browser, so you can try everything without a headset. Simulated output is always labelled synthetic.

## Why I built it

I wanted something that gives a cricketer real feedback on how they swing, using hardware many people already own, and I wanted to treat it as an engineering problem: calibration maths, signal processing, geometry, a testable core separate from the rendering, and honest accuracy limits.

## Try it without a headset

Open https://manimod7.github.io/swinglab/ and choose **Drill, then Run the simulator**. Then open **Review** to see the replay. To run it locally:

```
python3 -m http.server 8000      # then open http://localhost:8000
```

## On the headset

The Quest Browser needs an HTTPS page, which GitHub Pages provides.

1. **Device check first.** On the Quest, open `https://manimod7.github.io/swinglab/xr-check.html`. It confirms WebXR and immersive VR work, measures how often each controller reports a pose, and measures jitter while the bat is held still. Keep the results.
2. **Enter VR** on the main page and follow the three calibration steps on the panel:
   1. Pull the trigger on the controller that is *not* on the bat. Rest the toe on the floor, pull the trigger again, and swirl the handle in wide circles for 6 seconds. This finds the bat tip (pivot calibration).
   2. Take your stance facing the bowler, blade facing the bowler, pull the trigger and hold still for 3 seconds. This sets the blade-face direction and the bowling line.
   3. Ten balls follow. After the set the panel shows average rating, bat speed and repeatability, and the session is saved in the browser. Pull the free trigger for another set.
3. Back on the page, **Review** shows the replay and charts; **Download** saves the session as JSON.

## Hardware

- Meta Quest 3 (one controller on the bat, the other free to confirm steps).
- A 3D-printed bat that holds a Quest 3 controller rigidly. Rigid mounting matters: any wobble between controller and bat shows up as swing error.
- Space for a full swing, a clear floor, and your own safety judgement. Check the area before every session.

## How it works

| Module | Job |
|---|---|
| `src/calibration.js` | Pivot calibration (linear least squares for the tip offset, with outlier trimming) and stance calibration (blade-face direction). |
| `src/swing.js` | Tip series, swing segmentation by tip speed with hysteresis, metrics and session consistency. |
| `src/drill.js` | Bowling-machine planner, ball physics, swept ball-vs-blade contact test, outcome model, 0 to 100 rating. |
| `src/drillcore.js` | The drill controller: one pose per frame in, events and results out. No rendering code, so it can be tested in Node. |
| `src/simbatter.js`, `src/synth.js` | Scripted batter and sensor-noise model for the simulator, tests and the sample session, at a fixed 72 Hz. |
| `src/main.js`, `src/scene.js`, `src/hud.js` | three.js scene, WebXR session handling and the heads-up panel. |
| `src/review.js` | Session review: 3D replay, speed chart, tables. |
| `src/math.js`, `src/content.js`, `src/session.js` | Vector and quaternion maths, page copy, session save and load. |

**Drill frame.** Origin on the floor under your head when you set your stance, +Y up, the bowler along -Z, +X to your right. Headset poses are converted into it.

**Why a swept contact test?** A fast bat can move further than the ball's size in one frame and pass straight through it. Testing the blade's swept volume between frames prevents that "tunnelling".

## Metrics

- **Peak bat speed** from frame-to-frame tip movement. At 72 Hz it reads a few percent under the true instantaneous peak.
- **Swing plane tilt:** angle of the best-fit plane through the downswing from vertical (0 = vertical). Plane deviation is the RMS distance from that plane.
- **Swing path:** direction of the bat through the hitting zone, degrees right (+) or left (-) of the line to the bowler.
- **Backlift height:** highest the tip gets in the 0.7 s before peak speed.
- **Timing:** when the tip crosses the hitting plane minus when the ball does. Negative means early.
- **Repeatability:** `100 / (1 + mean(sd_i / tolerance_i))` over five metrics, with tolerances 1.5 m/s, 6 deg, 6 deg, 0.10 m and 40 ms.

## Shot rating

`100 x (0.45 contact + 0.30 power + 0.25 control)`

- **Contact:** how near the sweet spot (18 cm from the toe) and how central across the blade.
- **Power:** exit speed over 38 m/s.
- **Control:** direction within about 40 degrees of straight, and kept low.

The weights are a judgement, not a measured truth.

## Tests

```
bash tests/run_tests.sh
```

Runs **15 Node tests** (maths, calibration recovery to a few millimetres, metrics against noiseless ground truth, delivery planner, contact and rating, reproducible simulated session) and the mocked-headset flow test (needs Python with Playwright). Regenerate the synthetic sample with `node tools/make_sample.mjs`.

## Session file

```
{ format: "swinglab-session", version: 1, synthetic,
  calibration: { tip_local, face_local, rms_mm, length_m },
  swings: [ { n, label, rating, metrics, shot,
              frames: [[t, px,py,pz, qx,qy,qz,qw], ...],
              ball_path: [[t, x,y,z], ...] } ] }
```

## FAQ

**Do I need a headset?** No, the simulator runs everywhere. You need a Quest 3 for real swings.

**Does it work on Quest 2 or other headsets?** Not tested. It targets Quest 3 controllers in the Quest Browser.

**Is it accurate?** The maths is tested against ground truth in simulation. Real accuracy depends on Quest tracking, which is good but not a lab instrument. The device check measures jitter on your own unit.

**Does it need an account, server or internet connection?** No account and no server. It needs the page loaded once from HTTPS. No analytics are collected.

**Where are my sessions stored?** In your browser, and they leave only when you press Download.

**Why is the rating subjective?** The 45/30/25 weights are a design judgement.

**Why not use an existing cricket VR game?** Only one immersive app runs on a Quest at a time, and iB Cricket does not export swing data, so SwingLab is its own scene.

**Is the ball physics realistic?** It is deliberately simple: no spin or swing.

## Limits

- Tracking is the Quest 3's own.
- Headset mode is not yet validated on a real device.
- The ball is virtual and the physics is simple.
- Calibration assumes a rigidly mounted controller.

## Licence

MIT for this code (see `LICENSE`). `vendor/` holds three.js (MIT, see `vendor/THREE_LICENSE`). Built by Manish Modwani.
