import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { batGeometry } from './calibration.js';
import { BLADE_LEN } from './drill.js';
import { ratingColor } from './hud.js';
import { len, sub } from './math.js';
import { makeBall, makeBat, makeField, makeTrail, poseBat } from './scene.js';
import { loadLocal, unpackFrames, validateSession } from './session.js';
import { METRIC_LABELS, consistency } from './swing.js';

const $ = (id) => document.getElementById(id);
const R = { ready: false, sessions: [], cur: null, swing: null, tmin: 0, tmax: 1, playing: false, t: 0 };
const f1 = (x, d = 0) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(d));

export async function initReview() {
  if (R.ready) { resize(); return; }
  R.ready = true;
  const canvas = $('rgl');
  R.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  R.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  R.scene = new THREE.Scene(); R.scene.background = new THREE.Color(0x9fb7c9); R.scene.fog = new THREE.Fog(0x9fb7c9, 14, 50);
  R.camera = new THREE.PerspectiveCamera(48, 4 / 3, 0.05, 100); R.camera.position.set(1.6, 1.5, 1.9);
  R.controls = new OrbitControls(R.camera, canvas); R.controls.target.set(0, 0.9, -1.4); R.controls.enableDamping = true; R.controls.update();
  R.scene.add(makeField());
  R.bat = makeBat(0.8); R.scene.add(R.bat);
  R.ball = makeBall(); R.scene.add(R.ball);
  R.trail = makeTrail(400); R.scene.add(R.trail);
  R.ballTrail = makeTrail(400, 0xff5a5a); R.scene.add(R.ballTrail);
  addEventListener('resize', resize);
  $('r-play').addEventListener('click', () => { if (!R.swing) return; if (R.t >= R.tmax - 1e-3) R.t = R.tmin; R.playing = !R.playing; $('r-play').textContent = R.playing ? 'Pause' : 'Play'; });
  $('r-scrub').addEventListener('input', (e) => { R.playing = false; $('r-play').textContent = 'Play'; R.t = R.tmin + (R.tmax - R.tmin) * (+e.target.value / 1000); draw(); });
  $('r-pick').addEventListener('change', (e) => showSession(R.sessions[+e.target.value]));
  $('r-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const s = validateSession(JSON.parse(await f.text())); s.__name = f.name; addSession(s, true); } catch (err) { $('r-lede').textContent = 'Could not open that file: ' + err.message; }
  });
  let last = performance.now();
  R.renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (R.playing && R.swing) { R.t += dt * 0.5; if (R.t >= R.tmax) { R.t = R.tmax; R.playing = false; $('r-play').textContent = 'Play'; } $('r-scrub').value = Math.round(1000 * (R.t - R.tmin) / (R.tmax - R.tmin)); draw(); }
    R.controls.update(); R.renderer.render(R.scene, R.camera);
  });
  let sample = null;
  try { const r = await fetch('data/sample_session.json'); if (r.ok) { sample = validateSession(await r.json()); sample.__name = 'Sample session (synthetic)'; } } catch (e) { /* offline or file missing */ }
  if (sample) R.sessions.push(sample);
  for (const s of loadLocal()) { try { validateSession(s); s.__name = `${s.synthetic ? 'Simulator' : 'Headset'} · ${s.created.slice(0, 16).replace('T', ' ')}`; R.sessions.push(s); } catch (e) { /* skip */ } }
  refreshPick();
  resize();
  if (R.sessions.length) showSession(R.sessions[0]);
  else $('r-lede').textContent = 'No sessions yet. Run the simulator or the headset drill, then come back, or open a session file.';
}

function addSession(s, select) { R.sessions.unshift(s); refreshPick(); if (select) showSession(s); }
function refreshPick() {
  $('r-pick').innerHTML = R.sessions.map((s, i) => `<option value="${i}">${s.__name || 'Session'}</option>`).join('');
}
function resize() {
  if (!R.renderer) return;
  const c = $('rgl'), w = c.parentElement.clientWidth, h = c.parentElement.clientHeight;
  if (!w || !h) return;
  R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
}

export function showSession(s) {
  if (!s) return;
  if (!R.ready) { initReview().then(() => showSession(s)); return; }
  if (!R.sessions.includes(s)) { s.__name = s.__name || `${s.synthetic ? 'Simulator' : 'Headset'} · ${s.created.slice(0, 16).replace('T', ' ')}`; R.sessions.unshift(s); refreshPick(); }
  R.cur = s; $('r-pick').value = String(R.sessions.indexOf(s));
  const sw = s.swings, withM = sw.filter((x) => x.metrics), hits = sw.filter((x) => x.rating);
  const cons = consistency(withM.map((x) => x.metrics));
  R.cons = cons;
  $('r-lede').textContent = (s.synthetic ? 'Synthetic session from the scripted batter. It shows the analysis working; it is not a recording of a person. ' : 'Recorded on a Meta Quest 3. ') + `${sw.length} balls, ${withM.length} swings found, ${hits.length} hit.`;
  const avg = hits.length ? hits.reduce((a, x) => a + x.rating.score, 0) / hits.length : null;
  const spd = withM.length ? withM.reduce((a, x) => a + x.metrics.peak_speed_kmh, 0) / withM.length : null;
  $('r-cards').innerHTML = [[f1(avg), 'average rating'], [f1(Math.max(0, ...hits.map((x) => x.rating.score))), 'best shot'], [f1(spd) + ' km/h', 'average bat speed'], [f1(cons.score), 'repeatability / 100'], [`${hits.length}/${sw.length}`, 'balls hit']]
    .map((c) => `<div class="card"><div class="n">${c[0]}</div><div class="l">${c[1]}</div></div>`).join('');
  $('r-list').innerHTML = sw.map((x, i) => `<li><button type="button" data-i="${i}"><span class="no">${x.n}</span><span>${x.label}<small>${x.metrics ? f1(x.metrics.peak_speed_kmh) + ' km/h' : 'no swing found'}${x.timing_text ? ' · ' + x.timing_text : ''}</small></span><span class="sc" style="color:${x.rating ? ratingColor(x.rating.score) : 'var(--muted)'}">${x.rating ? x.rating.score : '–'}</span></button></li>`).join('');
  $('r-list').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => selectSwing(+b.dataset.i)));
  $('r-cons').innerHTML = '<tr><th>Metric</th><th>Mean</th><th>Spread (sd)</th><th>Tolerance</th></tr>' + Object.keys(METRIC_LABELS).map((k) => {
    const m = cons.metrics[k] || {}, [name, unit] = METRIC_LABELS[k];
    return `<tr><td>${name}</td><td>${f1(m.mean, 1)} ${unit}</td><td>${f1(m.sd, 1)} ${unit}</td><td>${m.tolerance != null ? '±' + m.tolerance + ' ' + unit : '–'}</td></tr>`;
  }).join('');
  const first = sw.findIndex((x) => x.frames && x.frames.length);
  selectSwing(first >= 0 ? first : 0);
}

function selectSwing(i) {
  const s = R.cur, sw = s.swings[i];
  R.playing = false; $('r-play').textContent = 'Play';
  $('r-list').querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', +b.dataset.i === i));
  if (!sw || !sw.frames.length) { R.swing = null; R.trail.userData.set([], null); R.ballTrail.userData.set([], null); R.bat.visible = false; $('r-table').innerHTML = '<tr><td>No swing was detected for this ball.</td></tr>'; clearChart(); return; }
  const cal = s.calibration || { tip_local: [0, 0, -0.8] };
  const frames = unpackFrames(sw.frames);
  const geoms = frames.map((f) => batGeometry(f.p, f.q, cal, BLADE_LEN));
  const speeds = geoms.map((g, k) => (k ? len(sub(g.tip, geoms[k - 1].tip)) / Math.max(1e-3, frames[k].t - frames[k - 1].t) : 0));
  const tRel = sw.t_release != null ? sw.t_release : (sw.metrics && sw.metrics.timing_ms != null ? sw.metrics.cross_t - sw.metrics.timing_ms / 1000 - sw.ball.t_arrive : frames[0].t);
  R.swing = { sw, frames, geoms, speeds, tRel, tArrive: tRel + sw.ball.t_arrive };
  R.tmin = frames[0].t; R.tmax = frames[frames.length - 1].t; R.t = R.tmin;
  R.trail.userData.set(geoms.map((g) => g.tip), speeds);
  const bp = sw.ball_path.map((a) => [a[1], a[2], a[3]]);
  R.ballTrail.userData.set(bp, null);
  $('r-scrub').value = 0;
  table(sw); draw(); chart();
}

function draw() {
  const S = R.swing; if (!S) return;
  let k = 0; while (k < S.frames.length - 1 && S.frames[k + 1].t <= R.t) k++;
  R.bat.visible = true; poseBat(R.bat, S.geoms[k]);
  const tb = R.t - S.tRel, bp = S.sw.ball_path;
  if (tb >= 0 && tb <= bp[bp.length - 1][0]) {
    let j = 0; while (j < bp.length - 1 && bp[j + 1][0] <= tb) j++;
    R.ball.visible = true; R.ball.position.set(bp[j][1], bp[j][2], bp[j][3]);
  } else R.ball.visible = false;
  chart();
}

function table(sw) {
  const m = sw.metrics, cons = R.cons.metrics;
  const rows = [['Peak bat speed', m.peak_speed_ms, 'm/s', 'peak_speed_ms', 1], ['Swing plane tilt', m.plane_tilt_deg, '°', 'plane_tilt_deg', 1], ['Swing path', m.path_deg, '° (+ right)', 'path_deg', 1], ['Backlift height', m.backlift_m, 'm', 'backlift_m', 2], ['Downswing time', m.downswing_ms, 'ms', null, 0], ['Timing', m.timing_ms, 'ms (− early)', 'timing_ms', 0]];
  if (sw.shot) rows.push(['Contact point', sw.shot.s_from_toe_m * 100, 'cm from toe', null, 0], ['Exit speed', sw.shot.exit_kmh, 'km/h', null, 0]);
  $('r-table').innerHTML = '<tr><th>This swing</th><th>Value</th><th>Session mean</th></tr>' + rows.map((r) => `<tr><td>${r[0]}</td><td>${f1(r[1], r[4])} ${r[2]}</td><td>${r[3] && cons[r[3]] && cons[r[3]].mean != null ? f1(cons[r[3]].mean, r[4]) : '–'}</td></tr>`).join('');
}

function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function clearChart() { const c = $('r-chart'), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); }
function chart() {
  const S = R.swing, c = $('r-chart'); if (!S) return;
  const x = c.getContext('2d'), W = c.width, H = c.height, P = { l: 52, r: 16, t: 30, b: 34 };
  x.clearRect(0, 0, W, H);
  const t0 = R.tmin, t1 = R.tmax, vmax = Math.max(10, Math.ceil(Math.max(...S.speeds) * 3.6 / 20) * 20);
  const X = (t) => P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r), Y = (v) => H - P.b - v / vmax * (H - P.t - P.b);
  x.font = '500 20px Barlow, system-ui, sans-serif'; x.fillStyle = css('--muted'); x.strokeStyle = css('--line'); x.lineWidth = 1;
  for (let v = 0; v <= vmax; v += 20) { x.beginPath(); x.moveTo(P.l, Y(v)); x.lineTo(W - P.r, Y(v)); x.stroke(); x.textAlign = 'right'; x.fillText(String(v), P.l - 8, Y(v) + 6); }
  x.textAlign = 'left'; x.fillText('km/h', 8, 20);
  for (let s = Math.ceil(t0 * 2) / 2; s <= t1; s += 0.5) { x.fillText((s - t0).toFixed(1) + ' s', X(s), H - 10); }
  x.strokeStyle = css('--a'); x.lineWidth = 3; x.beginPath();
  S.frames.forEach((f, k) => { const px = X(f.t), py = Y(S.speeds[k] * 3.6); k ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
  const mark = (t, label, col, align = 'left') => { if (t < t0 || t > t1) return; x.strokeStyle = col; x.setLineDash([5, 4]); x.lineWidth = 1.5; x.beginPath(); x.moveTo(X(t), P.t); x.lineTo(X(t), H - P.b); x.stroke(); x.setLineDash([]); x.fillStyle = col; x.textAlign = align; x.fillText(label, X(t) + (align === 'left' ? 5 : -5), P.t - 8); };
  mark(S.tArrive, 'ball', css('--b'), 'right');
  if (S.sw.metrics) mark(S.sw.metrics.t_peak, 'peak', css('--ink'));
  x.strokeStyle = css('--ink'); x.lineWidth = 2; x.beginPath(); x.moveTo(X(R.t), P.t); x.lineTo(X(R.t), H - P.b); x.stroke();
}
