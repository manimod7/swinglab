// Turn a stream of controller poses into swings and per-swing metrics.
// Frames are { t (s), p:[x,y,z], q:[x,y,z,w] } in the drill frame: origin on the floor under the player's head,
// +Y up, the bowler along -Z, so +X is to the player's right.
import { add, clamp, cross, deg, dot, eigenSym3, len, mul, norm, quatRotate, sub } from './math.js';

export const DEFAULTS = { startSpeed: 1.5, minPeak: 5.0, mergeGap: 0.35, minDuration: 0.12, maxDuration: 2.5, zHit: -0.6 };

/** Bat-tip series and frame-to-frame speeds. Position noise (about 1.5 mm) is tiny next to swing speeds, so no smoothing is applied;
 *  at 72 Hz the sampled peak still reads a few percent under the true peak, which the README states. */
export function tipSeries(frames, tip_local) {
  const n = frames.length, tip = frames.map((f) => add(f.p, quatRotate(f.q, tip_local)));
  // Speed over the interval ending at each frame (backward difference; entry 0 copies entry 1).
  const vel = tip.map((_, i) => {
    const b = Math.max(1, i), dt = frames[b].t - frames[b - 1].t || 1e-3;
    return mul(sub(tip[b], tip[b - 1]), 1 / dt);
  });
  return frames.map((f, i) => ({ t: f.t, tip: tip[i], vel: vel[i], speed: len(vel[i]), hand: f.p }));
}

/** Find swings: runs where speed stays above startSpeed, merged across short pauses (the top of the backlift), kept if the peak is high enough. */
export function segmentSwings(series, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const runs = [];
  let start = -1;
  for (let i = 0; i < series.length; i++) {
    const on = series[i].speed > o.startSpeed;
    if (on && start < 0) start = i;
    if ((!on || i === series.length - 1) && start >= 0) { runs.push([start, on ? i : i - 1]); start = -1; }
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && series[r[0]].t - series[last[1]].t < o.mergeGap) last[1] = r[1]; else merged.push([...r]);
  }
  return merged.filter(([a, b]) => {
    const dur = series[b].t - series[a].t;
    let peak = 0;
    for (let i = a; i <= b; i++) peak = Math.max(peak, series[i].speed);
    return peak >= o.minPeak && dur >= o.minDuration && dur <= o.maxDuration;
  });
}

function fitPlane(points) {
  const c = points.reduce((a, p) => add(a, p), [0, 0, 0]).map((v) => v / points.length);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += d[i] * d[j]; }
  const { values, vectors } = eigenSym3(S);
  return { centroid: c, normal: vectors[0], rms: Math.sqrt(Math.max(values[0], 0) / points.length) };
}

/** Metrics for one swing [a,b] (indices into series). ballArrive = absolute time the ball reaches the hitting plane, if there is a ball. */
export function swingMetrics(series, [a, b], opt = {}, ballArrive = null) {
  const o = { ...DEFAULTS, ...opt };
  let pk = a;
  for (let i = a; i <= b; i++) if (series[i].speed > series[pk].speed) pk = i;
  const tPeak = series[pk].t;
  // Backlift: highest the tip got in the 0.7 s before the peak (the top of the backswing).
  let top = pk;
  for (let i = pk; i >= 0 && series[pk].t - series[i].t <= 0.7; i--) if (series[i].tip[1] > series[top].tip[1]) top = i;
  // Downswing plane: from the top of the backlift to just after peak speed.
  let end = pk;
  while (end < b && series[end].t - tPeak < 0.04) end++;
  const pts = series.slice(top, end + 1).map((s) => s.tip);
  let plane = { tilt_deg: null, dev_cm: null };
  if (pts.length >= 6) {
    const f = fitPlane(pts);
    plane = { tilt_deg: deg(Math.asin(clamp(Math.abs(f.normal[1]), 0, 1))), dev_cm: f.rms * 100 };
  }
  // Swing direction: speed-weighted mean velocity within 30 ms of the peak (the single peak sample is too jumpy).
  let v = [0, 0, 0];
  for (let i = a; i <= b; i++) if (Math.abs(series[i].t - tPeak) <= 0.03) v = add(v, mul(series[i].vel, series[i].speed));
  const path_deg = deg(Math.atan2(v[0], -v[2]));            // + = to the player's right of the line to the bowler
  const elev_deg = deg(Math.atan2(-v[1], Math.hypot(v[0], v[2]))); // + = bat moving downward
  // Timing: when the tip crosses the hitting plane, relative to the ball.
  let cross_t = null;
  for (let i = Math.max(top, a) + 1; i <= b; i++) {
    const z0 = series[i - 1].tip[2], z1 = series[i].tip[2];
    if (z0 > o.zHit && z1 <= o.zHit) { const f = (z0 - o.zHit) / (z0 - z1); cross_t = series[i - 1].t + f * (series[i].t - series[i - 1].t); break; }
  }
  return {
    t_start: series[a].t, t_end: series[b].t, t_peak: tPeak,
    peak_speed_ms: series[pk].speed, peak_speed_kmh: series[pk].speed * 3.6,
    backlift_m: series[top].tip[1], downswing_ms: (tPeak - series[top].t) * 1000,
    plane_tilt_deg: plane.tilt_deg, plane_dev_cm: plane.dev_cm,
    path_deg, bat_descent_deg: elev_deg,
    tip_height_at_peak_m: series[pk].tip[1],
    timing_ms: cross_t != null && ballArrive != null ? (cross_t - ballArrive) * 1000 : null,
    cross_t,
  };
}

const TOL = { peak_speed_ms: 1.5, plane_tilt_deg: 6, path_deg: 6, backlift_m: 0.10, timing_ms: 40 };
export const METRIC_LABELS = {
  peak_speed_ms: ['Peak bat speed', 'm/s'], plane_tilt_deg: ['Swing plane tilt', '°'], path_deg: ['Swing path', '°'],
  backlift_m: ['Backlift height', 'm'], timing_ms: ['Timing', 'ms'],
};

/** Session consistency: mean and spread of each metric, and one 0-100 repeatability score. */
export function consistency(metricsList) {
  const out = { n: metricsList.length, metrics: {}, score: null };
  const ratios = [];
  for (const k of Object.keys(TOL)) {
    const xs = metricsList.map((m) => m[k]).filter((x) => x != null && Number.isFinite(x));
    if (xs.length < 2) { out.metrics[k] = { n: xs.length, mean: xs[0] ?? null, sd: null }; continue; }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
    out.metrics[k] = { n: xs.length, mean, sd, tolerance: TOL[k] };
    ratios.push(sd / TOL[k]);
  }
  if (ratios.length) out.score = 100 / (1 + ratios.reduce((a, b) => a + b, 0) / ratios.length);
  return out;
}
