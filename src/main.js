import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { batGeometry, pivotCalibrate, stanceCalibrate } from './calibration.js';
import { Drill } from './drillcore.js';
import { BLADE_LEN } from './drill.js';
import { drawHud, ratingColor } from './hud.js';
import { len, quatFromAxisAngle, quatMul, quatRotate, sub } from './math.js';
import { makeBall, makeBat, makeField, makeTrail, poseBat } from './scene.js';
import { downloadJSON, newSession, saveLocal } from './session.js';
import { SimBatter } from './simbatter.js';
import { pivotWobble, sampleFrames, swingModel } from './synth.js';
import { initReview, showSession } from './review.js';
import { aboutHtml, hardwareHtml } from './content.js';

const $ = (id) => document.getElementById(id);
const S = { mode: null, phase: null, drill: null, sim: null, cal: null, session: null, t0: 0 };

/* ---------- chrome: tabs, theme ---------- */
const tabs = ['drill', 'review', 'hw', 'about'];
function showTab(name) {
  for (const t of tabs) {
    const on = t === name;
    $('t-' + t).setAttribute('aria-selected', on); $('t-' + t).tabIndex = on ? 0 : -1; $('v-' + t).hidden = !on;
  }
  if (name === 'drill') requestAnimationFrame(resize);
  if (name === 'review') initReview();
  try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
}
tabs.forEach((t) => $('t-' + t).addEventListener('click', () => showTab(t)));
$('theme').addEventListener('click', () => {
  const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = dark ? 'light' : 'dark';
});
$('hw').innerHTML = hardwareHtml(); $('about').innerHTML = aboutHtml();

/* ---------- 3D scene ---------- */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.xr.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb7c9); scene.fog = new THREE.Fog(0x9fb7c9, 18, 60);
const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.05, 120);
camera.position.set(1.9, 1.55, 2.5);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, -3); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.update();
const root = new THREE.Group(); scene.add(root);
root.add(makeField());
const bat = makeBat(0.8); root.add(bat);
const ball = makeBall(); root.add(ball);
const swingTrail = makeTrail(300), ballTrail = makeTrail(400, 0xff5a5a);
root.add(swingTrail, ballTrail);
const markA = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0xe8b27a }));
const markB = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0x63a8e0 }));
markA.visible = markB.visible = false; scene.add(markA, markB);

const hudCanvas = $('hud');
const hudTex = new THREE.CanvasTexture(hudCanvas);
const hudPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, side: THREE.DoubleSide }));
hudPlane.visible = false; scene.add(hudPlane);
function hud(m) { drawHud(hudCanvas, m); hudTex.needsUpdate = true; }

function resize() {
  if (renderer.xr.isPresenting) return;
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ---------- drill plumbing shared by simulator and headset ---------- */
const logEl = $('log');
function logResult(r) {
  const li = document.createElement('li');
  const sc = r.rating ? r.rating.score : '–';
  li.innerHTML = `<b style="color:${r.rating ? ratingColor(r.rating.score) : 'inherit'}">${sc}</b>#${r.n} ${r.label}${r.metrics ? ' · ' + Math.round(r.metrics.peak_speed_kmh) + ' km/h' : ''}${r.timing_text ? ' · ' + r.timing_text : ''}`;
  logEl.appendChild(li);
}
const f1 = (x, d = 0) => (x == null ? '–' : x.toFixed(d));

function onEvent(e) {
  if (e.type === 'planned') {
    if (S.sim) S.sim.onPlanned(e, S.now);
    ballTrail.userData.set([], null);
    hud({ kicker: 'Drill', progress: `Ball ${e.n} of ${e.of}`, title: 'Get ready', lines: [`A ${e.plan.speed_kph} km/h ball is coming. Stand in your stance, blade facing the bowler.`], foot: S.mode === 'sim' ? 'Simulated batter. No headset needed.' : '' });
  } else if (e.type === 'release') {
    hud({ kicker: 'Drill', progress: `Ball ${e.n} of ${e.of}`, title: 'Bowled', lines: [`${e.plan.speed_kph} km/h`] });
  } else if (e.type === 'result') {
    const r = e.result, m = r.metrics;
    hud({
      kicker: 'Drill', progress: `Ball ${e.n} of ${e.of}`, big: r.rating ? r.rating.score : '–', bigColor: r.rating ? ratingColor(r.rating.score) : '#ee6169', label: r.label, sub: r.timing_text,
      rows: m ? [['Bat speed', f1(m.peak_speed_kmh) + ' km/h'], ['Exit speed', r.rating ? f1(r.rating.exit_kmh) + ' km/h' : '–'], ['Swing plane', f1(m.plane_tilt_deg) + '° tilt'], ['Path', `${f1(Math.abs(m.path_deg))}° ${m.path_deg >= 0 ? 'right' : 'left'}`], ['Backlift', f1(m.backlift_m, 2) + ' m'], ['Contact', r.shot ? f1(r.shot.s_from_toe_m * 100) + ' cm from toe' : '–']] : null,
      lines: m ? null : ['No swing was detected for this ball.'],
    });
    logResult(r);
    showSwingTrail(r);
  } else if (e.type === 'done') finishSet(e.summary);
}
function showSwingTrail(r) {
  if (!r.frames.length) return;
  const cal = S.cal, pts = [], sp = [];
  let prev = null;
  for (const a of r.frames) {
    const g = batGeometry([a[1], a[2], a[3]], [a[4], a[5], a[6], a[7]], cal, BLADE_LEN);
    pts.push(g.tip); sp.push(prev ? len(sub(g.tip, prev.tip)) / Math.max(1e-3, a[0] - prev.t) : 0); prev = { tip: g.tip, t: a[0] };
  }
  swingTrail.userData.set(pts, sp);
}
function finishSet(sum) {
  const s = newSession({ synthetic: S.mode === 'sim', cal: S.cal, note: S.mode === 'sim' ? 'Recorded from the built-in simulated batter. Not a real recording.' : 'Recorded on a Meta Quest 3 with the SwingLab bat.' });
  s.swings = S.drill.results; s.summary = sum;
  S.session = s; saveLocal(s);
  $('dl-session').hidden = false; $('open-review').hidden = false;
  const c = sum.consistency;
  hud({
    kicker: 'Set complete', big: sum.avg_rating != null ? Math.round(sum.avg_rating) : '–', bigColor: sum.avg_rating != null ? ratingColor(sum.avg_rating) : '#ee6169', label: 'average rating',
    sub: `${sum.contacts} of ${sum.balls} balls hit`,
    rows: [['Avg bat speed', f1(sum.avg_peak_speed_kmh) + ' km/h'], ['Best shot', sum.best_rating != null ? String(sum.best_rating) : '–'], ['Repeatability', c.score != null ? f1(c.score) + ' / 100' : '–'], ['Swings found', String(sum.swings)]],
    foot: S.mode === 'xr' ? 'Pull the trigger on the free controller for another set.' : 'Press "Run the simulator" for another set.',
  });
}
$('dl-session').addEventListener('click', () => S.session && downloadJSON(S.session));
$('open-review').addEventListener('click', () => { showTab('review'); showSession(S.session); });

function setStatus(msg) { $('xr-status').textContent = msg; }
function newDrill(t) {
  logEl.innerHTML = ''; swingTrail.userData.set([], null); ballTrail.userData.set([], null);
  S.drill = new Drill({ cal: S.cal, seed: Math.floor(Math.random() * 1e6), balls: 10, onEvent });
  S.drill.start(t);
}

/* ---------- simulator ---------- */
function startSim() {
  stopAll();
  const seed = Math.floor(Math.random() * 1e4);
  const pc = pivotCalibrate(pivotWobble({ seed }));
  const st = stanceCalibrate(sampleFrames(swingModel({ tHit: 1e6 }).pose, { t0: 0, t1: 1, seed: seed + 1 }), pc.tip_local);
  S.cal = { tip_local: pc.tip_local, face_local: st.face_local, rms_mm: pc.rms_mm, length_m: pc.length_m };
  S.mode = 'sim'; S.sim = new SimBatter({ seed }); S.t0 = performance.now() / 1000; S.now = 0;
  controls.enabled = true;
  newDrill(0);
  $('run-sim').hidden = true; $('stop-sim').hidden = false; $('dl-session').hidden = true; $('open-review').hidden = true;
  setStatus(`Simulated batter. Calibration check: bat length ${pc.length_m.toFixed(2)} m, residual ${pc.rms_mm.toFixed(1)} mm.`);
  banner('Simulator: a scripted batter with human-like variation. Nothing here is a real recording.');
}
function stopAll() {
  S.mode = null; S.drill = null; S.sim = null; $('run-sim').hidden = false; $('stop-sim').hidden = true;
  ball.visible = false; bat.visible = true;
}
$('run-sim').addEventListener('click', startSim);
$('stop-sim').addEventListener('click', () => { stopAll(); idleHud(); banner(null); });
function banner(msg) { const b = $('banner'); b.hidden = !msg; b.textContent = msg || ''; }
function idleHud() { hud({ kicker: 'SwingLab', title: 'Ready', lines: ['Run the simulator, or put on a Quest 3 and press Enter VR.'] }); }

/* ---------- headset ---------- */
let xrSession = null;
async function detectXR() {
  if (!window.isSecureContext) { setStatus('Headset mode needs a secure (HTTPS) page. The simulator works anywhere.'); return; }
  if (!navigator.xr) { setStatus('No WebXR here. Open this page in the Meta Quest Browser to use the headset, or run the simulator.'); return; }
  try {
    if (await navigator.xr.isSessionSupported('immersive-vr')) { $('enter-vr').hidden = false; setStatus('Headset detected. Press Enter VR, or try the simulator first.'); }
    else setStatus('This browser has WebXR but no immersive VR. Use the Meta Quest Browser, or run the simulator.');
  } catch (e) { setStatus('Could not check for a headset: ' + e.message); }
}
$('enter-vr').addEventListener('click', async () => {
  try {
    stopAll();
    xrSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(xrSession);
    S.mode = 'xr'; S.phase = 'pair'; S.cal = { tip_local: [0, 0, -0.8], face_local: null }; S.x = { prev: {}, cap: null, placed: false };
    xrSession.addEventListener('end', () => { S.mode = null; xrSession = null; hudPlane.visible = false; scene.add(hudPlane); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); resize(); idleHud(); });
  } catch (e) { setStatus('Could not start VR: ' + e.message); }
});

const trig = (src) => !!(src.gamepad && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed);
function stepXR(t, frame) {
  const ref = renderer.xr.getReferenceSpace();
  const viewer = frame.getViewerPose(ref);
  if (!viewer) return;
  const hp = viewer.transform.position, ho = viewer.transform.orientation;
  const head = { p: [hp.x, hp.y, hp.z], q: [ho.x, ho.y, ho.z, ho.w] };
  const inputs = {};
  for (const src of xrSession.inputSources) {
    if (!src.gripSpace) continue;
    const pose = frame.getPose(src.gripSpace, ref);
    if (!pose) continue;
    const p = pose.transform.position, q = pose.transform.orientation;
    inputs[src.handedness] = { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], trig: trig(src) };
  }
  const X = S.x;
  const press = (h) => inputs[h] && inputs[h].trig && !X.prev[h];
  const fwd = quatRotate(head.q, [0, 0, -1]);
  const flat = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
  if (!X.placed) {            // put the panel in front of the player's head, once
    const f = flat(fwd); hudPlane.position.set(head.p[0] + f[0] * 1.7, 1.45, head.p[2] + f[2] * 1.7); hudPlane.lookAt(head.p[0], 1.45, head.p[2]); hudPlane.visible = true; X.placed = true;
    hud({ kicker: 'Calibration 1 of 3', title: 'Pick the free controller', lines: ['Hold the bat in one hand. Pull the trigger on the OTHER controller, the one that is not on the bat.'] });
  }
  const both = inputs.left && inputs.right;
  const batIn = X.bat && inputs[X.bat], freeIn = X.free && inputs[X.free];
  if (S.phase === 'pair') {
    for (const h of ['left', 'right']) if (press(h) && both) { X.free = h; X.bat = h === 'left' ? 'right' : 'left'; S.phase = 'pivot-prep'; hud({ kicker: 'Calibration 1 of 3', title: 'Find the bat tip', lines: ['Rest the toe of the bat on one spot on the floor. Pull the free trigger, then swirl the handle in wide circles for 6 seconds without letting the toe slide.'] }); }
  } else if (S.phase === 'pivot-prep' && freeIn && press(X.free)) {
    X.cap = { t0: t, samples: [] }; S.phase = 'pivot'; hud({ kicker: 'Calibration 1 of 3', title: 'Swirl the handle', lines: ['Keep the toe still. Wide circles, tilting each way.'] });
  } else if (S.phase === 'pivot' && batIn) {
    X.cap.samples.push({ p: batIn.p, q: batIn.q });
    if (t - X.cap.t0 > 6) {
      const r = pivotCalibrate(X.cap.samples);
      if (r.ok) { X.pc = r; S.cal = { tip_local: r.tip_local, face_local: null }; S.phase = 'pivot-done'; hud({ kicker: 'Calibration 1 of 3', title: 'Bat tip found', lines: [`Length ${r.length_m.toFixed(2)} m, residual ${r.rms_mm.toFixed(1)} mm.`, 'Pull the free trigger to continue.'] }); }
      else { S.phase = 'pivot-prep'; hud({ kicker: 'Calibration 1 of 3', title: 'Try again', lines: [r.reason, 'Pull the free trigger to retry.'] }); }
    }
  } else if (S.phase === 'pivot-done' && freeIn && press(X.free)) {
    S.phase = 'stance-prep'; hud({ kicker: 'Calibration 2 of 3', title: 'Take your stance', lines: ['Stand where you will bat, facing the bowler. Hold the bat as at the crease, blade facing the bowler. Pull the free trigger, then hold still for 3 seconds.'] });
  } else if (S.phase === 'stance-prep' && freeIn && press(X.free)) {
    X.cap = { t0: t, samples: [], heads: [] }; S.phase = 'stance'; hud({ kicker: 'Calibration 2 of 3', title: 'Hold still', lines: ['Bat in your stance, blade facing the bowler.'] });
  } else if (S.phase === 'stance' && batIn) {
    X.cap.samples.push({ p: batIn.p, q: batIn.q }); X.cap.heads.push(head);
    if (t - X.cap.t0 > 3) {
      const hs = X.cap.heads, mx = hs.reduce((a, h) => a + h.p[0], 0) / hs.length, mz = hs.reduce((a, h) => a + h.p[2], 0) / hs.length;
      const f = flat(quatRotate(hs[hs.length - 1].q, [0, 0, -1])), th = Math.atan2(-f[0], -f[2]);
      const st = stanceCalibrate(X.cap.samples, X.pc.tip_local, f);
      if (!st.ok) { S.phase = 'stance-prep'; hud({ kicker: 'Calibration 2 of 3', title: 'Try again', lines: [st.reason, 'Pull the free trigger to retry.'] }); }
      else {
        S.cal = { tip_local: X.pc.tip_local, face_local: st.face_local, rms_mm: X.pc.rms_mm, length_m: X.pc.length_m };
        root.position.set(mx, 0, mz); root.rotation.set(0, th, 0); X.origin = [mx, 0, mz]; X.theta = th; X.qInv = quatFromAxisAngle([0, 1, 0], -th);
        root.add(hudPlane); hudPlane.position.set(-1.1, 1.5, -2.3); hudPlane.rotation.set(0, Math.atan2(1.1, 2.3), 0);
        S.phase = 'drill'; newDrill(t);
        setStatus('Drill running in VR.');
      }
    }
  } else if (S.phase === 'drill' || S.phase === 'done') {
    if (batIn) {
      const rel = [batIn.p[0] - X.origin[0], batIn.p[1], batIn.p[2] - X.origin[2]];
      const c = Math.cos(-X.theta), s = Math.sin(-X.theta);
      const p = [rel[0] * c + rel[2] * s, rel[1], -rel[0] * s + rel[2] * c];
      S.drill.update({ t, p, q: quatMul(X.qInv, batIn.q) });
      if (S.drill.state === 'done') S.phase = 'done';
    }
    if (S.phase === 'done' && freeIn && press(X.free)) { S.phase = 'drill'; newDrill(t); }
  }
  for (const h of ['left', 'right']) X.prev[h] = !!(inputs[h] && inputs[h].trig);
  // Markers for the two controllers until the bat model takes over; the bat model uses the latest calibration.
  markA.visible = markB.visible = true;
  if (freeIn) markA.position.set(...freeIn.p); else markA.visible = false;
  if (batIn) { markB.position.set(...batIn.p); if (S.phase !== 'drill' && S.phase !== 'done') { root.updateMatrixWorld(); previewBat(batIn); } } else markB.visible = false;
  if (S.phase === 'drill' || S.phase === 'done') markB.visible = markA.visible = false;
}
function previewBat(b) {   // before calibration finishes: a bat drawn in world space with the current best tip offset
  const g = batGeometry(b.p, b.q, S.cal, BLADE_LEN);
  bat.visible = true; poseBat(bat, g);
}

/* ---------- frame loop ---------- */
function loop(time, frame) {
  const t = time / 1000;
  if (S.mode === 'sim' && S.drill) {
    // The simulator ticks at a fixed 72 Hz like the headset, whatever the display's frame rate is.
    const target = t - S.t0, dt = 1 / 72;
    for (let k = 0; k < 40 && S.now + dt <= target; k++) { S.now += dt; const ps = S.sim.pose(S.now); S.drill.update({ t: S.now, p: ps.p, q: ps.q }); }
  } else if (S.mode === 'xr' && frame && xrSession) stepXR(t, frame);
  const d = S.drill;
  if (d && d.bat && (S.mode === 'sim' || S.phase === 'drill' || S.phase === 'done')) { bat.visible = true; poseBat(bat, d.bat); }
  if (d) {
    const show = d.state === 'flight' && d.ball;
    ball.visible = !!show;
    if (show) ball.position.set(...d.ball.pos);
    if (d.path && d.path.length > 1 && (d.state === 'flight' || d.state === 'waiting')) ballTrail.userData.set(d.path.slice(-400).map((a) => [a[1], a[2], a[3]]), null);
    if (d.state === 'flight' && d.trail.length) { const tr = d.trail.filter((x) => x.t > d.tArrive - 0.9); swingTrail.userData.set(tr.map((x) => x.tip), tr.map((x) => x.speed)); }
  }
  if (!renderer.xr.isPresenting) { controls.update(); hudPlane.visible = false; }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(loop);

idleHud(); resize(); detectXR();
const startTab = (location.hash || '').slice(1);
if (tabs.includes(startTab)) showTab(startTab);
window.__swinglab = { S, startSim, hud, showTab, test: {
  // Test hooks: drive the headset code path with a mocked WebXR frame (used by tests/xr_flow.py).
  beginXR() { S.mode = 'xr'; S.phase = 'pair'; S.cal = { tip_local: [0, 0, -0.8], face_local: null }; S.x = { prev: {}, cap: null, placed: false }; xrSession = { inputSources: [] }; renderer.xr.getReferenceSpace = () => 'ref'; },
  step(t, frame, sources) { xrSession.inputSources = sources; stepXR(t, frame); },
} };
