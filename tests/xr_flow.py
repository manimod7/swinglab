"""Drives the headset code path (calibration -> stance -> drill) with a mocked WebXR frame and synthetic poses placed at an arbitrary
spot and heading in the room, to prove the world-to-drill-frame transform and the whole state machine. Needs: python3 -m http.server 8130."""
import json, sys
from playwright.sync_api import sync_playwright

JS = r"""
async () => {
  const M = await import('/src/math.js'), Y = await import('/src/synth.js'), SB = await import('/src/simbatter.js');
  const sl = window.__swinglab, S = sl.S, T = sl.test;
  const th0 = 0.7, origin = [1.3, 0, -2.1];
  const toWorld = (p, q) => { const c = Math.cos(th0), s = Math.sin(th0); return { p: [p[0] * c + p[2] * s + origin[0], p[1], -p[0] * s + p[2] * c + origin[2]], q: M.quatMul(M.quatFromAxisAngle([0, 1, 0], th0), q) }; };
  const headQ = M.quatFromAxisAngle([0, 1, 0], th0), headP = [origin[0], 1.7, origin[2]];
  let t = 0; const dt = 1 / 72;
  const src = (h, ps, trig) => ({ handedness: h, gripSpace: h, gamepad: { buttons: [{ pressed: trig }] }, __pose: ps });
  const frame = (poses) => ({ getViewerPose: () => ({ transform: { position: { x: headP[0], y: headP[1], z: headP[2] }, orientation: { x: headQ[0], y: headQ[1], z: headQ[2], w: headQ[3] } } }),
    getPose: (sp) => { const ps = poses[sp]; return { transform: { position: { x: ps.p[0], y: ps.p[1], z: ps.p[2] }, orientation: { x: ps.q[0], y: ps.q[1], z: ps.q[2], w: ps.q[3] } } }; } });
  const free = { p: [0.4, 1.2, -0.3], q: [0, 0, 0, 1] };
  let batPose = { p: [0, 1, 0], q: [0, 0, 0, 1] };
  const tick = (trigLeft) => { const poses = { left: free, right: batPose }; T.step(t, frame(poses), [src('left', free, trigLeft), src('right', batPose, false)]); t += dt; };
  const log = [];
  T.beginXR();
  for (let i = 0; i < 10; i++) tick(false);
  for (let i = 0; i < 5; i++) tick(true); log.push(S.phase);                 // pick the free controller
  for (let i = 0; i < 5; i++) tick(false);
  const wob = Y.pivotWobble({ n: 520, floorPoint: [2.0, 0, -1.0], seed: 3 });
  batPose = { p: [0.3, 0.9, 0.2], q: [0, 0, 0, 1] };                          // a few stray frames before the swirl, as a real player would have
  for (let i = 0; i < 5; i++) tick(true); log.push(S.phase);                 // start the pivot capture
  for (const w of wob) { batPose = { p: w.p, q: w.q }; tick(false); } log.push(S.phase);
  for (let i = 0; i < 3; i++) tick(false);
  for (let i = 0; i < 5; i++) tick(true); log.push(S.phase);                 // continue to stance prep
  for (let i = 0; i < 5; i++) tick(false);
  const st0 = Y.swingModel({ tHit: 1e6 });
  const stanceFrames = Y.sampleFrames(st0.pose, { t0: 0, t1: 4, seed: 9 });
  batPose = toWorld(stanceFrames[0].p, stanceFrames[0].q);
  for (let i = 0; i < 5; i++) tick(true); log.push(S.phase);                 // start the stance hold
  for (let k = 0; k < 260; k++) { const f = stanceFrames[k % stanceFrames.length]; batPose = toWorld(f.p, f.q); tick(false); }
  log.push(S.phase);
  const cal = S.cal;
  const sim = new SB.SimBatter({ seed: 42 }); S.sim = sim;
  let guard = 0;
  while (S.phase !== 'done' && guard++ < 72 * 90) { S.now = t; const ps = sim.pose(t); batPose = toWorld(ps.p, ps.q); tick(false); }
  if (!S.drill) return { log, phase: S.phase, fail: true, msg: document.getElementById('hud') && 'no drill' };
  const sum = S.drill.summary();
  return { log, phase: S.phase, calLen: cal && cal.length_m, calRms: cal && cal.rms_mm, hasFace: !!(cal && cal.face_local), rootPos: [S.drill ? 1 : 0], results: S.drill.results.map(r => ({ n: r.n, label: r.label, score: r.rating && r.rating.score, speed: r.metrics && Math.round(r.metrics.peak_speed_kmh), timing: r.metrics && r.metrics.timing_ms && Math.round(r.metrics.timing_ms) })), sum: { contacts: sum.contacts, swings: sum.swings, avg: sum.avg_rating } };
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8130/index.html'); pg.wait_for_timeout(1200)
    r = pg.evaluate(JS)
    print(json.dumps(r, indent=1)[:2500]); print('errors', errs)
    ok = r['log'] == ['pivot-prep', 'pivot', 'pivot-done', 'stance', 'drill'] or r['log'][:3] == ['pivot-prep', 'pivot', 'pivot-done']
    assert r['phase'] == 'done', r['phase']
    assert abs(r['calLen'] - 0.8) < 0.01 and r['calRms'] < 5 and r['hasFace']
    assert r['sum']['contacts'] >= 6 and r['sum']['swings'] >= 8, r['sum']
    assert not errs
    print('XR FLOW OK'); b.close()
