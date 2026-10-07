// The virtual drill: a bowling machine, simple ball physics, a swept contact test between ball and blade,
// and a transparent 0-100 shot rating. Physics is deliberately simple; the goal is feedback, not a simulator.
import { add, clamp, cross, deg, dot, len, lerp, mul, norm, sub } from './math.js';

export const G = 9.81, BALL_R = 0.036, BLADE_REACH = 0.05, CONTACT_R = BALL_R + BLADE_REACH;
export const SWEET_SPOT_M = 0.18;        // distance from the toe to the middle of the blade
export const RESTITUTION = 0.35;         // effective, bat-and-ball
const COR_Y = 0.55, COR_Z = 0.75, SIDE_KEEP = 0.9;

export function stepBall(b, dt) {
  const steps = Math.max(1, Math.ceil(dt / 0.002)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    b.vel[1] -= G * h;
    b.pos = add(b.pos, mul(b.vel, h));
    if (b.pos[1] <= BALL_R && b.vel[1] < 0) {
      b.pos[1] = BALL_R;
      b.vel = [b.vel[0] * SIDE_KEEP, -b.vel[1] * COR_Y, b.vel[2] * COR_Z];
      b.bounces = (b.bounces || 0) + 1;
    }
  }
  return b;
}

function fly(pos, vel, zHit) {
  const b = { pos: [...pos], vel: [...vel], bounces: 0 };
  let t = 0, bounceZ = null;
  while (b.pos[2] < zHit && t < 3) {
    stepBall(b, 0.002); t += 0.002;
    if (b.bounces === 1 && bounceZ === null) bounceZ = b.pos[2];
  }
  return { t, pos: b.pos, bounceZ, bounces: b.bounces };
}

/** Plan one delivery: choose the vertical release speed so the ball reaches the hitting plane at the target height,
 *  and the sideways speed so it arrives on the target line. Speeds in km/h, lengths in metres. */
export function planDelivery({ speed_kph = 70, release = [0, 2.1, -14], target_h = 0.8, line_x = 0, zHit = -0.6 } = {}) {
  const vz = speed_kph / 3.6;
  let best = null;
  const tryVy = (vy) => {
    const r = fly(release, [0, vy, vz], zHit);
    if (r.bounces < 1 || r.bounceZ < zHit - 9 || r.bounceZ > zHit - 1.0) return;
    const err = Math.abs(r.pos[1] - target_h);
    if (!best || err < best.err) best = { vy, err };
  };
  for (let vy = -9; vy <= 4; vy += 0.02) tryVy(vy);
  if (!best) throw new Error('No delivery found for these settings');
  const center = best.vy;
  for (let vy = center - 0.02; vy <= center + 0.02; vy += 0.0005) tryVy(vy);
  const vyBest = best.vy;
  const flat = fly(release, [0, vyBest, vz], zHit);
  // Sideways: x(t) = x0 + vx * (time before the bounce + SIDE_KEEP * time after); solve for vx.
  const pre = (() => { const b = { pos: [...release], vel: [0, vyBest, vz], bounces: 0 }; let t = 0; while (b.bounces < 1 && t < 3) { stepBall(b, 0.002); t += 0.002; } return t; })();
  const eff = pre + SIDE_KEEP * (flat.t - pre);
  const vx = (line_x - release[0]) / eff;
  const vel0 = [vx, vyBest, vz];
  const fin = fly(release, vel0, zHit);
  return { release: [...release], vel0, t_arrive: fin.t, arrive_pos: fin.pos, bounce_z: fin.bounceZ, speed_kph, zHit };
}

function closestOnSegment(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { t, point: add(a, mul(ab, t)) };
}

export const BLADE_HALF_WIDTH = 0.054, BLADE_HALF_THICK = 0.03, BLADE_LEN = 0.55;

/** Swept ball-vs-blade test between two frames. bat0/bat1 = { top, tip, face }. The blade is a flat plate in the bat frame:
 *  s along the bat from the toe, "across" the blade width, and distance from the face plane. Falls back to a capsule when no face is known. */
export function sweptContact(ball0, ball1, bat0, bat1, dt, substeps = 16) {
  for (let i = 1; i <= substeps; i++) {
    const f = i / substeps;
    const bp = lerp(ball0, ball1, f), top = lerp(bat0.top, bat1.top, f), tip = lerp(bat0.tip, bat1.tip, f);
    const axisVec = sub(top, tip), bladeLen = len(axisVec), axis = norm(axisVec);
    let hit = false, s, across = 0, edgeDir = null, point;
    if (bat0.face && bat1.face) {
      let face = norm(lerp(bat0.face, bat1.face, f));
      face = norm(sub(face, mul(axis, dot(face, axis))));
      const wid = cross(axis, face), r = sub(bp, tip);
      s = dot(r, axis); across = dot(r, wid);
      const dn = dot(r, face);
      hit = s >= -BALL_R && s <= bladeLen + BALL_R && Math.abs(across) <= BLADE_HALF_WIDTH + BALL_R * 0.5 && Math.abs(dn) <= BALL_R + BLADE_HALF_THICK;
      edgeDir = wid; point = add(tip, mul(axis, clamp(s, 0, bladeLen)));
    } else {
      const c = closestOnSegment(bp, tip, top);
      const d = len(sub(bp, c.point));
      hit = d <= CONTACT_R; s = c.t * bladeLen; across = d; point = c.point;
      edgeDir = d > 1e-6 ? norm(sub(bp, c.point)) : null;
    }
    if (hit) {
      const tt = clamp(s / (bladeLen || 1), 0, 1);
      const pointAt = (g) => { const tp = lerp(bat0.tip, bat1.tip, g), tpp = lerp(bat0.top, bat1.top, g); return add(tp, mul(sub(tpp, tp), tt)); };
      const g0 = Math.max(0, f - 1 / substeps), g1 = Math.min(1, f + 1 / substeps);
      const v_bat = mul(sub(pointAt(g1), pointAt(g0)), 1 / (dt * (g1 - g0) || 1e-3));
      return { frac: f, ball_pos: bp, bat_point: point, s_from_toe_m: Math.max(0, s), across_m: across, dist_m: Math.abs(across), edge_dir: edgeDir, v_bat };
    }
  }
  return null;
}

/** Ball velocity after contact. Face-on impacts leave along the blade-face normal; impacts near the blade edge deflect sideways. */
export function contactOutcome(contact, v_in, face) {
  const rel = sub(v_in, contact.v_bat);
  let n = face && len(face) > 0.5 ? norm(face) : norm(contact.v_bat);
  if (dot(n, rel) > 0) n = mul(n, -1);
  const edgeK = clamp((contact.dist_m - 0.03) / 0.04, 0, 1) * 0.8;
  if (edgeK > 0 && contact.edge_dir) {
    let r = mul(contact.edge_dir, Math.sign(contact.across_m) || 1);
    if (dot(r, rel) > 0) r = mul(r, -1);
    n = norm(add(mul(n, 1 - edgeK), mul(r, edgeK)));
  }
  const lat = 1 - 0.7 * clamp(contact.dist_m / (BLADE_HALF_WIDTH + 0.02), 0, 1) ** 2;
  const along = Math.exp(-(((contact.s_from_toe_m - SWEET_SPOT_M) / 0.11) ** 2));
  const contact_q = clamp(along * lat, 0, 1);
  const e = RESTITUTION * (0.5 + 0.5 * contact_q);
  const vn = dot(rel, n);
  const v_out = sub(v_in, mul(n, (1 + e) * vn));
  return { v_out, speed: len(v_out), contact_q };
}

/** Transparent rating. 45% contact quality, 30% power, 25% control (direction and loft). */
export function rateShot(out) {
  const v = out.v_out, sp = out.speed;
  const az = deg(Math.atan2(v[0], -v[2])), el = deg(Math.atan2(v[1], Math.hypot(v[0], v[2])));
  const power = clamp(sp / 38, 0, 1);
  let control = 0;
  if (v[2] < 0) control = Math.exp(-((Math.abs(az) / 40) ** 2)) * (el <= 20 ? 1 : Math.exp(-(el - 20) / 25));
  const score = 100 * (0.45 * out.contact_q + 0.30 * power + 0.25 * control);
  return { score: Math.round(score), contact_q: out.contact_q, power, control, exit_speed_ms: sp, exit_kmh: sp * 3.6, direction_deg: az, loft_deg: el };
}

export function shotLabel(rating, s_from_toe_m) {
  if (rating.contact_q < 0.35) return s_from_toe_m < 0.08 ? 'Off the toe' : s_from_toe_m > 0.34 ? 'High on the bat' : 'Edged';
  if (rating.score >= 80) return 'Middled';
  if (rating.score >= 60) return 'Solid';
  if (rating.control < 0.4) return 'Mistimed';
  return 'Scratchy';
}

export function timingWord(ms) {
  if (ms == null) return '';
  if (Math.abs(ms) <= 15) return 'On time';
  return ms < 0 ? `${Math.round(-ms)} ms early` : `${Math.round(ms)} ms late`;
}
