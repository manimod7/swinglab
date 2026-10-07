// The drill controller. It is fed one controller pose per tracking frame (from the headset or the simulator), runs the bowling
// machine, detects contact, finds each swing, computes its metrics and rating, and emits events. It knows nothing about three.js.
import { batGeometry } from './calibration.js';
import { BLADE_LEN, contactOutcome, planDelivery, rateShot, shotLabel, stepBall, sweptContact, timingWord } from './drill.js';
import { rng } from './math.js';
import { packFrames } from './session.js';
import { consistency, segmentSwings, swingMetrics, tipSeries } from './swing.js';

export const Z_HIT = -0.6;

export class Drill {
  constructor({ cal, seed = 1, balls = 10, interval = 4.5, speeds = [65, 75, 85], onEvent = () => {} }) {
    Object.assign(this, { cal, balls, interval, speeds, onEvent });
    this.rand = rng(seed);
    this.buf = []; this.results = []; this.n = 0; this.state = 'idle';
    this.prevBat = null; this.ball = null; this.plan = null; this.trail = [];
  }
  emit(type, data) { this.onEvent({ type, ...data }); }

  start(t) { this.state = 'waiting'; this.n = 0; this.results = []; this.planNext(t + 2.5); }

  planNext(tRelease) {
    const i = this.n;
    const plan = planDelivery({ speed_kph: this.speeds[Math.floor(this.rand() * this.speeds.length)], target_h: 0.55 + 0.4 * this.rand(), line_x: (this.rand() - 0.5) * 0.24, zHit: Z_HIT });
    this.plan = plan; this.tRelease = tRelease; this.tArrive = tRelease + plan.t_arrive;
    this.emit('planned', { n: i + 1, of: this.balls, plan, tRelease, tArrive: this.tArrive });
  }

  update(frame) {
    const t = frame.t;
    this.buf.push(frame);
    while (this.buf.length && t - this.buf[0].t > 12) this.buf.shift();
    const bat = batGeometry(frame.p, frame.q, this.cal, BLADE_LEN);
    this.bat = bat;
    const last = this.trail[this.trail.length - 1];
    this.trail.push({ t, tip: bat.tip, speed: last && t > last.t ? Math.hypot(bat.tip[0] - last.tip[0], bat.tip[1] - last.tip[1], bat.tip[2] - last.tip[2]) / (t - last.t) : 0 });
    while (this.trail.length && t - this.trail[0].t > 2.2) this.trail.shift();
    if (this.state === 'waiting' && t >= this.tRelease) this.release(t);
    else if (this.state === 'flight') this.flight(t, bat);
    this.prevBat = bat;
  }

  release(t) {
    this.ball = { pos: [...this.plan.release], vel: [...this.plan.vel0], bounces: 0 };
    this.tRel = t; this.lastBallT = t; this.contact = null; this.out = null;
    this.path = [[0, ...this.ball.pos]];
    this.state = 'flight';
    this.emit('release', { n: this.n + 1, of: this.balls, plan: this.plan, tRel: t });
  }

  flight(t, bat) {
    const dt = t - this.lastBallT;
    if (dt <= 0) return;
    this.lastBallT = t;
    const prev = [...this.ball.pos];
    stepBall(this.ball, Math.min(dt, 0.05));
    if (!this.contact && this.prevBat) {
      const c = sweptContact(prev, this.ball.pos, this.prevBat, bat, dt);
      if (c) {
        const out = contactOutcome(c, this.ball.vel, bat.face);
        this.contact = c; this.out = out;
        this.ball.pos = [...c.ball_pos]; this.ball.vel = [...out.v_out];
        stepBall(this.ball, (1 - c.frac) * dt);
        this.emit('contact', { contact: c, out, rating: rateShot(out) });
      }
    }
    this.path.push([t - this.tRel, ...this.ball.pos]);
    const over = t - this.tRel > this.plan.t_arrive + (this.contact ? 2.2 : 1.1) || this.ball.pos[2] > 8;
    if (over) this.finish(t);
  }

  finish(t) {
    const series = tipSeries(this.buf.filter((f) => f.t >= this.tArrive - 1.7 && f.t <= this.tArrive + 1.3), this.cal.tip_local);
    const segs = segmentSwings(series, { zHit: Z_HIT });
    let best = null;
    for (const s of segs) {
      const m = swingMetrics(series, s, { zHit: Z_HIT }, this.tArrive);
      if (!best || Math.abs(m.t_peak - this.tArrive) < Math.abs(best.m.t_peak - this.tArrive)) best = { s, m };
    }
    if (best && Math.abs(best.m.t_peak - this.tArrive) > 0.9) best = null;
    let rating = null, label, shot = null;
    if (this.contact) {
      rating = rateShot(this.out);
      label = shotLabel(rating, this.contact.s_from_toe_m);
      shot = { s_from_toe_m: this.contact.s_from_toe_m, across_m: this.contact.across_m, exit_kmh: rating.exit_kmh, direction_deg: rating.direction_deg, loft_deg: rating.loft_deg };
    } else label = best ? 'Missed' : 'No swing';
    const m = best ? best.m : null;
    const lo = best ? best.m.t_start - 0.6 : 0, hi = best ? best.m.t_end + 0.3 : 0;
    const rec = {
      n: this.n + 1, t_release: this.tRel, ball: { speed_kph: this.plan.speed_kph, line_x: this.plan.arrive_pos[0], height_m: this.plan.arrive_pos[1], t_arrive: this.tArrive - this.tRel },
      label, timing_text: m ? timingWord(m.timing_ms) : '', metrics: m, rating, shot,
      frames: best ? packFrames(this.buf.filter((f) => f.t >= lo && f.t <= hi)) : [],
      ball_path: this.path.filter((_, i) => i % 1 === 0).map((a) => [Math.round(a[0] * 1e3) / 1e3, ...a.slice(1).map((x) => Math.round(x * 1e3) / 1e3)]),
    };
    this.results.push(rec); this.n++;
    this.emit('result', { result: rec, n: this.n, of: this.balls });
    if (this.n >= this.balls) { this.state = 'done'; this.emit('done', { summary: this.summary() }); }
    else { this.state = 'waiting'; this.planNext(Math.max(this.tRel + this.interval, t + 2.4)); }
  }

  summary() {
    const swings = this.results.filter((r) => r.metrics);
    const hits = this.results.filter((r) => r.rating);
    const cons = consistency(swings.map((r) => r.metrics));
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return { balls: this.results.length, swings: swings.length, contacts: hits.length,
      avg_rating: avg(hits.map((r) => r.rating.score)), best_rating: hits.length ? Math.max(...hits.map((r) => r.rating.score)) : null,
      avg_peak_speed_kmh: avg(swings.map((r) => r.metrics.peak_speed_kmh)), consistency: cons };
  }
}
