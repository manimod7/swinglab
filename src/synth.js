// Synthetic controller data: a physically plausible swing, and bat-calibration wobbles, with sensor noise.
// Used by the tests, by the desktop simulator, and to generate the sample session (always labelled synthetic).
import { add, cross, mul, norm, quatFromAxisAngle, quatFromFrames, quatMul, quatRotate, rad, rng, sub } from './math.js';

export const TRUE_TIP_LOCAL = [0.02, 0.03, -0.80];
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Returns pose(t) -> { p, q } for one swing. The bat rotates about the hands (pivot) in a swing plane; the hands stay put.
 *  hit = where the ball is struck (world), contactS = distance from the toe to that point on the bat. */
export function swingModel({ tHit = 3, hit = [0, 0.8, -0.6], v = 25, az = 0, tilt = 12, tipLocal = TRUE_TIP_LOCAL, contactS = 0.18, p = 3, psiStance = 165, psiTop = 30, psiHit = 165 } = {}) {
  const L = Math.hypot(...tipLocal);
  const w = [Math.sin(rad(az)), 0, -Math.cos(rad(az))];                // forward along the swing, horizontal
  const lat = cross(w, [0, 1, 0]);
  const u = [Math.cos(rad(tilt)) * 0 + Math.sin(rad(tilt)) * lat[0], Math.cos(rad(tilt)) + Math.sin(rad(tilt)) * lat[1], Math.sin(rad(tilt)) * lat[2]];
  const er = (psi) => sub(mul(u, Math.cos(rad(psi))), mul(w, Math.sin(rad(psi))));
  const tang = (psi) => sub(mul(u, -Math.sin(rad(psi))), mul(w, Math.cos(rad(psi))));
  const C = sub(hit, mul(er(psiHit), L - contactS));
  const omega = v / L;                                                 // rad/s at the hit
  const d1 = (rad(psiHit - psiTop) * p) / omega;
  const t0 = tHit - d1, tB0 = t0 - 0.6, tauD = 0.12;
  const psi = (t) => {
    if (t <= tB0) return psiStance;
    if (t < t0) return psiStance + (psiTop - psiStance) * smooth((t - tB0) / 0.6);
    if (t <= tHit) return psiTop + (psiHit - psiTop) * Math.pow((t - t0) / d1, p);
    return psiHit + deg((omega * tauD) * (1 - Math.exp(-(t - tHit) / tauD)));
  };
  const axisL = norm(tipLocal);
  const faceRaw = [1, 0, 0];
  const faceL = norm(sub(faceRaw, mul(axisL, faceRaw[0] * axisL[0] + faceRaw[1] * axisL[1] + faceRaw[2] * axisL[2])));
  const pose = (t) => { const ps = psi(t); return { p: C, q: quatFromFrames(axisL, faceL, norm(er(ps)), norm(tang(ps))) }; };
  return { pose, t0, tHit, d1, L, faceL, C, params: { tHit, hit, v, az, tilt } };
}
const deg = (r) => (r * 180) / Math.PI;

export function addNoise(pose, rand, posSigma = 0.0015, rotSigmaDeg = 0.15) {
  const ax = norm([rand.normal(), rand.normal(), rand.normal()]);
  const dq = quatFromAxisAngle(ax, rad(Math.abs(rand.normal()) * rotSigmaDeg));
  return { p: add(pose.p, [rand.normal() * posSigma, rand.normal() * posSigma, rand.normal() * posSigma]), q: quatMul(dq, pose.q) };
}

/** Sample a pose function into frames at a given rate with a little timestamp jitter and sensor noise. */
export function sampleFrames(pose, { t0 = 0, t1 = 6, hz = 72, seed = 1, noise = true } = {}) {
  const rand = rng(seed), out = [];
  for (let t = t0; t <= t1; t += 1 / hz) {
    const tt = t + (noise ? rand.normal() * 0.0004 : 0);
    const ps = noise ? addNoise(pose(tt), rand) : pose(tt);
    out.push({ t: tt, p: ps.p, q: ps.q });
  }
  return out;
}

/** Pivot-calibration wobble: the toe stays on one floor point while the handle is swirled. */
export function pivotWobble({ n = 360, tipLocal = TRUE_TIP_LOCAL, floorPoint = [0.1, 0, -0.5], seed = 7, tiltDeg = 35, noise = true } = {}) {
  const rand = rng(seed), out = [];
  const base = quatFromFrames(norm(tipLocal), norm(sub([1, 0, 0], mul(norm(tipLocal), norm(tipLocal)[0]))), [0, 1, 0], [1, 0, 0]);
  for (let i = 0; i < n; i++) {
    const phi = (i / n) * 4 * Math.PI, tilt = rad(tiltDeg * (0.6 + 0.4 * Math.sin(i / 17)));
    const swirl = quatFromAxisAngle([Math.cos(phi), 0, Math.sin(phi)], tilt);
    const spin = quatFromAxisAngle([0, 1, 0], rad(40 * Math.sin(i / 23)));
    let q = quatMul(spin, quatMul(swirl, base));
    let p = sub(floorPoint, quatRotate(q, tipLocal));
    if (noise) { const ps = addNoise({ p, q }, rand); p = ps.p; q = ps.q; }
    out.push({ t: i / 72, p, q });
  }
  return out;
}
