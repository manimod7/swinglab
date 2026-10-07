// Bat calibration. The controller reports its own pose; the bat tip sits at a fixed offset in the controller's frame.
// 1) Pivot calibration finds that offset: rest the toe on one spot and rotate the handle. Every sample satisfies
//    R_i * t + p_i = w  (t = tip offset in controller frame, w = the fixed floor point), a linear least-squares problem.
// 2) Stance calibration finds which way the blade face points, so the app knows the face normal during a swing.
import { add, cross, dot, len, mul, norm, quatConj, quatNorm, quatRotate, quatToMat, solveLinear, sub, angleBetween, deg } from './math.js';

function solvePivot(samples) {
  const AtA = Array.from({ length: 6 }, () => Array(6).fill(0)), Atb = Array(6).fill(0);
  for (const s of samples) {
    const R = quatToMat(s.q), p = s.p;
    for (let r = 0; r < 3; r++) {
      const row = [R[r][0], R[r][1], R[r][2], 0, 0, 0];
      row[3 + r] = -1;
      const rhs = -p[r];
      for (let a = 0; a < 6; a++) { Atb[a] += row[a] * rhs; for (let b = 0; b < 6; b++) AtA[a][b] += row[a] * row[b]; }
    }
  }
  return solveLinear(AtA, Atb);
}
const residuals = (samples, x) => samples.map((s) => len(sub(add(quatRotate(s.q, x.slice(0, 3)), s.p), x.slice(3))));

export function pivotCalibrate(allSamples) {
  if (allSamples.length < 30) return { ok: false, reason: 'Need at least 30 samples; keep rotating the bat for the full time.' };
  let samples = allSamples;
  let x = solvePivot(samples);
  if (x) {                         // drop outliers (for example the first moments before the toe settled) and refit once
    const res = residuals(samples, x), med = [...res].sort((a, b) => a - b)[res.length >> 1], thr = Math.max(0.006, 3 * med);
    const keep = samples.filter((_, i) => res[i] <= thr);
    if (keep.length < samples.length && keep.length >= 0.8 * samples.length) { const x2 = solvePivot(keep); if (x2) { x = x2; samples = keep; } }
  }
  const n = samples.length;
  const tip_local = x.slice(0, 3), pivot = x.slice(3);
  let sq = 0;
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const rt = quatRotate(samples[i].q, tip_local);
    const e = sub(add(rt, samples[i].p), pivot);
    sq += dot(e, e);
    dirs.push(norm(rt));
  }
  const rms_mm = Math.sqrt(sq / n) * 1000;
  const mean = norm(dirs.reduce((a, d) => add(a, d), [0, 0, 0]));
  const spread_deg = Math.max(...dirs.map((d) => deg(angleBetween(d, mean))));
  const length_m = len(tip_local);
  const problems = [];
  if (rms_mm > 10) problems.push(`Residual ${rms_mm.toFixed(1)} mm is high; the toe probably slid.`);
  if (spread_deg < 25) problems.push('The bat did not tilt enough; tilt it at least 25 degrees each way.');
  if (length_m < 0.3 || length_m > 1.3) problems.push(`Implausible bat length ${length_m.toFixed(2)} m.`);
  return { ok: problems.length === 0, reason: problems.join(' '), tip_local, pivot, rms_mm, spread_deg, length_m, n };
}

/** Average the controller orientation while the player holds the stance with the blade facing the bowler (-Z in drill frame). */
export function stanceCalibrate(samples, tip_local, bowlerDir = [0, 0, -1]) {
  if (samples.length < 10) return { ok: false, reason: 'Hold still for the full time.' };
  const ref = samples[0].q;
  let acc = [0, 0, 0, 0];
  for (const s of samples) {
    const sgn = ref[0] * s.q[0] + ref[1] * s.q[1] + ref[2] * s.q[2] + ref[3] * s.q[3] < 0 ? -1 : 1;
    acc = acc.map((v, k) => v + sgn * s.q[k]);
  }
  const qm = quatNorm(acc);
  const axisW = norm(quatRotate(qm, tip_local));
  let face = sub(bowlerDir, mul(axisW, dot(bowlerDir, axisW)));
  if (len(face) < 0.2) return { ok: false, reason: 'The bat is pointing at the bowler; hold it upright in your stance.' };
  face = norm(face);
  const face_local = norm(quatRotate(quatConj(qm), face));
  let jitter = 0;
  for (const sm of samples) {
    const d = Math.abs(qm[0] * sm.q[0] + qm[1] * sm.q[1] + qm[2] * sm.q[2] + qm[3] * sm.q[3]);
    jitter = Math.max(jitter, deg(2 * Math.acos(Math.min(1, d))));
  }
  return { ok: jitter < 8, reason: jitter < 8 ? '' : 'The bat moved during the hold; try again.', face_local, jitter_deg: jitter };
}

/** World-space bat geometry from a controller pose and the calibration. */
export function batGeometry(p, q, cal, bladeLen = 0.55) {
  const tip = add(p, quatRotate(q, cal.tip_local));
  const axis = norm(sub(tip, p));
  const top = sub(tip, mul(axis, bladeLen));
  const face = cal.face_local ? norm(sub(quatRotate(q, cal.face_local), mul(axis, dot(quatRotate(q, cal.face_local), axis)))) : null;
  return { tip, axis, top, face };
}
