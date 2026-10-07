// Session records: what is saved, exported and replayed. Plain JSON so the review page can open a file from the headset.
const r5 = (x) => Math.round(x * 1e5) / 1e5;
export const packFrames = (frames) => frames.map((f) => [Math.round(f.t * 1e4) / 1e4, ...f.p.map(r5), ...f.q.map(r5)]);
export const unpackFrames = (arr) => arr.map((a) => ({ t: a[0], p: [a[1], a[2], a[3]], q: [a[4], a[5], a[6], a[7]] }));

export function newSession({ synthetic = false, hz = 72, cal = null, note = '' } = {}) {
  return { format: 'swinglab-session', version: 1, created: new Date().toISOString(), synthetic, note, tracking_hz: hz,
    calibration: cal ? { tip_local: cal.tip_local, face_local: cal.face_local ?? null, rms_mm: cal.rms_mm ?? null, length_m: cal.length_m ?? null } : null,
    swings: [] };
}

export function validateSession(s) {
  if (!s || s.format !== 'swinglab-session' || !Array.isArray(s.swings)) throw new Error('This is not a SwingLab session file.');
  if (s.version !== 1) throw new Error('Unsupported session version ' + s.version);
  return s;
}

const KEY = 'swinglab.sessions.v1';
export function saveLocal(session) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]');
    all.unshift(session);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 8)));
    return true;
  } catch (e) { return false; }
}
export function loadLocal() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
export function downloadJSON(session, name) {
  const blob = new Blob([JSON.stringify(session)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name || `swinglab-${session.created.slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}
