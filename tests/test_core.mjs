import assert from 'node:assert/strict';
import { angleBetween, dot, eigenSym3, len, norm, quatConj, quatFromAxisAngle, quatFromFrames, quatMul, quatRotate, solveLinear, sub, add, mul, deg } from '../src/math.js';
import { batGeometry, pivotCalibrate, stanceCalibrate } from '../src/calibration.js';
import { consistency, segmentSwings, swingMetrics, tipSeries } from '../src/swing.js';
import { contactOutcome, planDelivery, rateShot, shotLabel, stepBall, sweptContact } from '../src/drill.js';
import { runSimSession } from '../tools/make_sample.mjs';
import { TRUE_TIP_LOCAL, pivotWobble, sampleFrames, swingModel } from '../src/synth.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, want ${b} ± ${tol}`);

test('quaternion rotate / conjugate / frames', () => {
  const q = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const v = quatRotate(q, [1, 0, 0]);
  near(v[2], -1, 1e-9); near(v[0], 0, 1e-9);
  const back = quatRotate(quatConj(q), v); near(back[0], 1, 1e-9);
  const q2 = quatFromFrames([1, 0, 0], [0, 1, 0], [0, 0, -1], [0, 1, 0]);
  const r = quatRotate(q2, [1, 0, 0]); near(r[2], -1, 1e-9);
});
test('linear solve and symmetric eigen', () => {
  const x = solveLinear([[2, 1], [1, 3]], [3, 5]); near(x[0], 0.8, 1e-9); near(x[1], 1.4, 1e-9);
  assert.equal(solveLinear([[1, 2], [2, 4]], [1, 2]), null);
  const e = eigenSym3([[2, 0, 0], [0, 5, 0], [0, 0, 1]]); near(e.values[0], 1, 1e-9); near(e.values[2], 5, 1e-9);
});
test('pivot calibration recovers the tip offset to a few mm', () => {
  const cal = pivotCalibrate(pivotWobble({}));
  assert.ok(cal.ok, cal.reason);
  const err = len(sub(cal.tip_local, TRUE_TIP_LOCAL)) * 1000;
  assert.ok(err < 4, `tip offset error ${err.toFixed(2)} mm`);
  assert.ok(cal.rms_mm < 4, `rms ${cal.rms_mm}`);
});
test('pivot calibration rejects a rotation that does not vary enough', () => {
  const flat = pivotWobble({ tiltDeg: 3, noise: false });
  const cal = pivotCalibrate(flat);
  assert.equal(cal.ok, false);
});
test('stance calibration points the face at the bowler', () => {
  const m = swingModel({ tHit: 20 });
  const frames = sampleFrames(m.pose, { t0: 0, t1: 3 });
  const st = stanceCalibrate(frames, TRUE_TIP_LOCAL);
  assert.ok(st.ok, st.reason);
  const g = batGeometry(frames[10].p, frames[10].q, { tip_local: TRUE_TIP_LOCAL, face_local: st.face_local });
  near(len(g.face), 1, 1e-6); near(dot(g.face, g.axis), 0, 1e-6, 'face is perpendicular to the bat axis');
  assert.ok(dot(g.face, [0, 0, -1]) > 0.9, `face dot bowler ${dot(g.face, [0, 0, -1])}`);
});

const swing = (o = {}) => {
  const m = swingModel({ tHit: 3, hit: [0.05, 0.8, -0.6], v: 25, az: 10, tilt: 15, ...o });
  return { m, frames: sampleFrames(m.pose, { t0: 0, t1: 6, seed: 3 }), clean: sampleFrames(m.pose, { t0: 0, t1: 6, hz: 1000, noise: false }) };
};

test('swing metrics match the noiseless ground truth', () => {
  const { m, frames, clean } = swing();
  const ref = tipSeries(clean, TRUE_TIP_LOCAL);
  const refPeak = Math.max(...ref.map((s) => s.speed));
  const series = tipSeries(frames, TRUE_TIP_LOCAL);
  const segs = segmentSwings(series);
  assert.equal(segs.length, 1);
  const met = swingMetrics(series, segs[0], {}, 3.0);
  near(met.peak_speed_ms, refPeak, 0.08 * refPeak, 'peak speed (sampled estimate sits a few percent under the true peak)');
  near(met.plane_tilt_deg, 15, 2.5, 'plane tilt');
  near(met.timing_ms, 0, 12, 'timing');
  assert.ok(met.backlift_m > 1.8 && met.backlift_m < 2.4, `backlift ${met.backlift_m}`);
  const rp = ref.findIndex((s) => s.speed === refPeak);
  const rpath = deg(Math.atan2(ref[rp].vel[0], -ref[rp].vel[2]));
  near(met.path_deg, rpath, 4, 'path');
});
test('timing sign: bat early when the ball arrives later', () => {
  const { frames } = swing();
  const series = tipSeries(frames, TRUE_TIP_LOCAL);
  const met = swingMetrics(series, segmentSwings(series)[0], {}, 3.05);
  assert.ok(met.timing_ms < -35 && met.timing_ms > -65, `timing ${met.timing_ms}`);
});
test('segmentation finds several swings and ignores fidgeting', () => {
  const swings = [2, 6, 10].map((t, i) => swingModel({ tHit: t, v: 20 + 3 * i, az: 5 * i }));
  const fid = swingModel({ tHit: 100 });
  const pose = (t) => { for (const s of swings) if (Math.abs(t - s.tHit) < 2) return s.pose(t); return { p: fid.pose(t).p, q: quatMul(quatFromAxisAngle([0, 1, 0], 0.06 * Math.sin(5 * t)), fid.pose(0).q) }; };
  const series = tipSeries(sampleFrames(pose, { t0: 0, t1: 13, seed: 5 }), TRUE_TIP_LOCAL);
  assert.equal(segmentSwings(series).length, 3);
});
test('delivery planner hits the target height and line', () => {
  for (const kph of [70, 80, 100]) {
    const d = planDelivery({ speed_kph: kph, target_h: 0.8, line_x: 0.1 });
    near(d.arrive_pos[1], 0.8, 0.02, `${kph} kph height`); near(d.arrive_pos[0], 0.1, 0.02, 'line');
    assert.ok(d.bounce_z < -1.8 && d.bounce_z > -8, `bounce ${d.bounce_z}`);
  }
});

function runDrill({ lateMs = 0, speed = 25, az = 5, ballKph = 70 }) {
  const plan = planDelivery({ speed_kph: ballKph, target_h: 0.8, line_x: 0.05 });
  const tRel = 1.0, tArrive = tRel + plan.t_arrive;
  const m = swingModel({ tHit: tArrive + lateMs / 1000, hit: [0.05, 0.8, -0.6], v: speed, az, tilt: 10 });
  const frames = sampleFrames(m.pose, { t0: 0, t1: tArrive + 1.5, seed: 11 });
  const stance = stanceCalibrate(frames.filter((f) => f.t < 0.5), TRUE_TIP_LOCAL);
  const cal = { tip_local: TRUE_TIP_LOCAL, face_local: stance.face_local };
  const ball = { pos: [...plan.release], vel: [...plan.vel0], bounces: 0 };
  let prevBall = [...ball.pos], prevBat = null, hit = null, lastT = tRel;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const bat = batGeometry(f.p, f.q, cal);
    if (f.t >= tRel && !hit) {
      const dt = f.t - lastT; lastT = f.t;
      if (dt <= 0) { prevBat = bat; continue; }
      prevBall = [...ball.pos];
      stepBall(ball, dt);
      if (prevBat) {
        const c = sweptContact(prevBall, ball.pos, prevBat, bat, dt);
        if (c) { const out = contactOutcome(c, ball.vel, bat.face); hit = { c, out, rating: rateShot(out) }; }
      }
    }
    prevBat = bat;
  }
  return { hit, plan };
}
test('well-timed swing makes good contact and rates well', () => {
  const { hit } = runDrill({});
  assert.ok(hit, 'expected contact');
  console.log('        debug', JSON.stringify({ s: hit.c.s_from_toe_m, across: hit.c.across_m, q: hit.out.contact_q, rating: hit.rating }));
  assert.ok(hit.c.s_from_toe_m > 0.08 && hit.c.s_from_toe_m < 0.30, `s=${hit.c.s_from_toe_m}`);
  assert.ok(hit.out.v_out[2] < 0, 'ball goes back toward the bowler');
  assert.ok(hit.out.speed > 20 && hit.out.speed < 50, `exit ${hit.out.speed}`);
  assert.ok(hit.rating.score >= 70, `rating ${hit.rating.score}`);
  console.log('        sample shot:', hit.rating.score, shotLabel(hit.rating, hit.c.s_from_toe_m), hit.rating.exit_kmh.toFixed(0), 'km/h, direction', hit.rating.direction_deg.toFixed(0), '°, contact_q', hit.out.contact_q.toFixed(2));
});
test('mistimed swings miss or rate clearly worse', () => {
  const good = runDrill({}).hit;
  for (const ms of [-150, 150]) {
    const h = runDrill({ lateMs: ms }).hit;
    assert.ok(h === null || h.rating.score < good.rating.score - 15, `${ms} ms: ${h && h.rating.score} vs ${good.rating.score}`);
  }
  for (const ms of [-300, 300]) assert.equal(runDrill({ lateMs: ms }).hit, null);
});
test('faster bat gives faster exit, rating monotone in bat speed', () => {
  const a = runDrill({ speed: 18 }).hit, b = runDrill({ speed: 28 }).hit;
  assert.ok(a && b);
  assert.ok(b.out.speed > a.out.speed, `${b.out.speed} vs ${a.out.speed}`);
});
test('consistency score: tight session beats loose session', () => {
  const mk = (sd) => Array.from({ length: 10 }, (_, i) => ({ peak_speed_ms: 24 + sd * Math.sin(i * 2.1), plane_tilt_deg: 14 + 3 * sd * Math.cos(i * 1.7), path_deg: 8 + 3 * sd * Math.sin(i), backlift_m: 2 + 0.05 * sd * Math.cos(i), timing_ms: 10 * sd * Math.sin(i * 3.3) }));
  const tight = consistency(mk(0.3)).score, loose = consistency(mk(2)).score;
  assert.ok(tight > loose + 20, `${tight} vs ${loose}`);
});
test('pivot calibration shrugs off stray samples at the start', () => {
  const w = pivotWobble({ n: 430, seed: 4 });
  const stray = Array.from({ length: 6 }, () => ({ t: 0, p: [0.3, 0.9, 0.2], q: [0, 0, 0, 1] }));
  const cal = pivotCalibrate([...stray, ...w]);
  assert.ok(cal.ok, cal.reason);
  assert.ok(len(sub(cal.tip_local, TRUE_TIP_LOCAL)) * 1000 < 4);
});
test('full simulated session is reproducible and sane', () => {
  const a = runSimSession({ seed: 21 }), b = runSimSession({ seed: 21 });
  assert.deepEqual(a.swings.map((x) => [x.label, x.rating && x.rating.score]), b.swings.map((x) => [x.label, x.rating && x.rating.score]));
  assert.equal(a.swings.length, 12);
  assert.ok(a.summary.contacts >= 6 && a.summary.contacts <= 12, `contacts ${a.summary.contacts}`);
  assert.ok(a.summary.avg_peak_speed_kmh > 55 && a.summary.avg_peak_speed_kmh < 110);
  for (const sw of a.swings) assert.ok(sw.frames.length === 0 || sw.frames.length > 20);
});
console.log(passed + ' tests passed');
