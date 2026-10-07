// One canvas-drawn heads-up panel, used as a DOM overlay on desktop and as a texture inside the headset.
const FONT = '"Barlow", system-ui, -apple-system, "Segoe UI", sans-serif';
const NUM = '"Barlow Condensed", "Arial Narrow", sans-serif';

export function drawHud(canvas, m) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(14,20,17,0.88)';
  roundRect(ctx, 0, 0, W, H, 26); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2; roundRect(ctx, 1, 1, W - 2, H - 2, 26); ctx.stroke();
  const pad = 36;
  ctx.fillStyle = '#e8b27a'; ctx.font = `600 26px ${FONT}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText((m.kicker || 'SwingLab').toUpperCase(), pad, 52);
  if (m.progress) { ctx.textAlign = 'right'; ctx.fillStyle = '#9aa8a0'; ctx.fillText(m.progress, W - pad, 52); ctx.textAlign = 'left'; }
  let y = 120;
  if (m.big != null) {
    ctx.fillStyle = m.bigColor || '#ecf0ea'; ctx.font = `700 112px ${NUM}`;
    ctx.fillText(String(m.big), pad, y + 40);
    const bw = ctx.measureText(String(m.big)).width;
    if (m.label) { ctx.font = `600 40px ${FONT}`; ctx.fillStyle = '#ecf0ea'; ctx.fillText(m.label, pad + bw + 24, y + 12); }
    if (m.sub) { ctx.font = `500 28px ${FONT}`; ctx.fillStyle = '#9aa8a0'; ctx.fillText(m.sub, pad + bw + 24, y + 48); }
    y += 100;
  } else if (m.title) {
    ctx.fillStyle = '#ecf0ea'; ctx.font = `600 46px ${FONT}`; ctx.fillText(m.title, pad, y + 12);
    y += 52;
  }
  if (m.lines) {
    ctx.font = `500 30px ${FONT}`; ctx.fillStyle = '#d6ddd7';
    for (const ln of m.lines) { for (const part of wrap(ctx, ln, W - 2 * pad)) { ctx.fillText(part, pad, y + 30); y += 40; } }
  }
  if (m.rows) {
    const cols = 2, cw = (W - 2 * pad) / cols;
    m.rows.forEach((r, i) => {
      const cx = pad + (i % cols) * cw, cy = y + 24 + Math.floor(i / cols) * 70;
      ctx.fillStyle = '#9aa8a0'; ctx.font = `500 24px ${FONT}`; ctx.fillText(r[0], cx, cy);
      ctx.fillStyle = '#ecf0ea'; ctx.font = `600 40px ${NUM}`; ctx.fillText(r[1], cx, cy + 36);
    });
  }
  if (m.foot) { ctx.fillStyle = '#e8b27a'; ctx.font = `500 26px ${FONT}`; const parts = wrap(ctx, m.foot, W - 2 * pad); parts.forEach((p, i) => ctx.fillText(p, pad, H - 28 - (parts.length - 1 - i) * 34)); }
}

function wrap(ctx, text, maxW) {
  const words = text.split(' '), out = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export const ratingColor = (s) => (s >= 80 ? '#53c58a' : s >= 60 ? '#e8b27a' : s >= 40 ? '#e0a050' : '#ee6169');
