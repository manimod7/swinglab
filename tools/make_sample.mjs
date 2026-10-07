// Generates data/sample_session.json: a SYNTHETIC session from the simulated batter, run through the same drill code as the headset app.
import fs from 'node:fs';
import { pivotCalibrate, stanceCalibrate } from '../src/calibration.js';
import { Drill } from '../src/drillcore.js';
import { newSession } from '../src/session.js';
import { SimBatter } from '../src/simbatter.js';
import { TRUE_TIP_LOCAL, pivotWobble, sampleFrames } from '../src/synth.js';
import { swingModel } from '../src/synth.js';

export function runSimSession({ balls = 12, seed = 21, hz = 72 } = {}) {
  const pc = pivotCalibrate(pivotWobble({ seed: seed + 1 }));
  const st0 = swingModel({ tHit: 1e6 });
  const st = stanceCalibrate(sampleFrames(st0.pose, { t0: 0, t1: 1, seed: seed + 2 }), pc.tip_local);
  const cal = { tip_local: pc.tip_local, face_local: st.face_local, rms_mm: pc.rms_mm, length_m: pc.length_m };
  const sim = new SimBatter({ seed });
  const drill = new Drill({ cal, seed, balls, onEvent: (e) => { if (e.type === 'planned') sim.onPlanned(e, t); } });
  let t = 0;
  drill.start(0);
  const dt = 1 / hz;
  while (drill.state !== 'done' && t < 400) { const ps = sim.pose(t); drill.update({ t, p: ps.p, q: ps.q }); t += dt; }
  const session = newSession({ synthetic: true, hz, cal, note: 'Synthetic session from the built-in simulated batter. Not a real recording.' });
  session.swings = drill.results;
  session.summary = drill.summary();
  return session;
}

if (process.argv[1] && process.argv[1].endsWith('make_sample.mjs')) {
  const s = runSimSession();
  fs.writeFileSync(new URL('../data/sample_session.json', import.meta.url), JSON.stringify(s));
  const sm = s.summary;
  console.log('swings', s.swings.length, 'contacts', sm.contacts, 'avg rating', sm.avg_rating && sm.avg_rating.toFixed(0), 'speed', sm.avg_peak_speed_kmh.toFixed(0), 'km/h', 'consistency', sm.consistency.score.toFixed(0));
  console.log(s.swings.map((r) => `${r.n}:${r.label}${r.rating ? '(' + r.rating.score + ')' : ''} ${r.timing_text}`).join('\n'));
  console.log('size KB', (JSON.stringify(s).length / 1024).toFixed(0));
}
