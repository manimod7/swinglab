// A scripted batter for the desktop simulator and the sample session. Human-like variation in timing, speed, plane and contact point.
// Between swings the bat eases back to the next stance so there are no jumps in the pose stream.
import { quatSlerp, rng, lerp, clamp } from './math.js';
import { TRUE_TIP_LOCAL, addNoise, swingModel } from './synth.js';

const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

export class SimBatter {
  constructor({ seed = 5, timingSd = 0.022, noise = true, tipLocal = TRUE_TIP_LOCAL } = {}) {
    this.rand = rng(seed); this.noiseRand = rng(seed + 1000); this.timingSd = timingSd; this.noise = noise; this.tipLocal = tipLocal;
    this.model = swingModel({ tHit: 1e6, tipLocal });
    this.from = this.model.pose(0); this.t0 = -1; this.t1 = -1;    // blend window
  }
  onPlanned(ev, now) {
    const r = this.rand, g = () => r.normal();
    const err = g() * this.timingSd;
    const hit = [ev.plan.arrive_pos[0] + g() * 0.015, ev.plan.arrive_pos[1] + g() * 0.025, ev.plan.zHit];
    const model = swingModel({ tHit: ev.tArrive + err, hit, v: clamp(24 + 3 * g(), 15, 31), az: 4 + 6 * g(), tilt: clamp(12 + 4 * g(), 2, 25),
      contactS: clamp(0.18 + 0.035 * g(), 0.06, 0.4), tipLocal: this.tipLocal });
    this.from = this.pose(now, false);
    this.t0 = now; this.t1 = model.tHit - model.d1 - 0.6;          // eased until the backlift starts
    this.stance = model.pose(-1e6);
    this.model = model;
    this.truth = { timing_err_ms: err * 1000 };
  }
  pose(t, withNoise = true) {
    let ps;
    if (t < this.t0 || this.t1 <= this.t0) ps = this.t0 < 0 ? this.model.pose(t) : this.from;
    else if (t < this.t1) { const k = smooth((t - this.t0) / (this.t1 - this.t0)); ps = { p: lerp(this.from.p, this.stance.p, k), q: quatSlerp(this.from.q, this.stance.q, k) }; }
    else ps = this.model.pose(t);
    return withNoise && this.noise ? addNoise(ps, this.noiseRand) : ps;
  }
}
