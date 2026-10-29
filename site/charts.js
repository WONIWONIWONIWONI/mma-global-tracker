// SVG 선 그래프와 캔들 차트
import { MIN, KST, fmt, signed, man, clamp, kd, hm, md } from "./format.js";

function niceTicks(min, max, n = 5) {
  const span = max - min || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / st) * st, hi = Math.ceil(max / st) * st, t = [];
  for (let v = lo; v <= hi + st / 2; v += st) t.push(+v.toFixed(10));
  return { lo, hi, t };
}
function timeTicks(a, b) {
  const span = (b - a) / MIN, steps = [30, 60, 120, 180, 360, 720, 1440, 2880];
  const st = steps.find(s => span / s <= 6) || 2880, ms = st * MIN, out = [];
  for (let t = Math.ceil((a + KST) / ms) * ms - KST; t <= b; t += ms) out.push(t);
  return { out, label: t => (st >= 1440 || kd(t).getUTCHours() === 0) ? md(t) : hm(t) };
}

function frame(el, H, yLo, yHi, yFmt, xA, xB, L = 58) {
  const W = Math.max(280, el.clientWidth || 700), R = 14, T = 12, B = 26;
  const nt = niceTicks(yLo, yHi, H > 220 ? 5 : 4);
  const x = t => L + (t - xA) / ((xB - xA) || 1) * (W - L - R);
  const y = v => T + (nt.hi - v) / ((nt.hi - nt.lo) || 1) * (H - T - B);
  let g = "";
  for (const v of nt.t) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 3.5}" text-anchor="end">${yFmt(v)}</text>`;
  if (nt.lo < 0 && nt.hi > 0) g += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1"/>`;
  const tt = timeTicks(xA, xB);
  for (const t of tt.out) g += `<line x1="${x(t)}" x2="${x(t)}" y1="${H - B}" y2="${H - B + 4}" stroke="var(--muted)"/><text x="${x(t)}" y="${H - 8}" text-anchor="middle">${tt.label(t)}</text>`;
  return { W, H, L, R, T, B, x, y, g };
}

function attachTip(el, fr, onX) {
  const svg = el.querySelector("svg"), tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; el.appendChild(tip);
  const cross = svg.querySelector(".cross");
  svg.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * fr.W;
    if (px < fr.L || px > fr.W - fr.R) { tip.hidden = true; cross.setAttribute("opacity", 0); return; }
    const res = onX(px); if (!res) return;
    cross.setAttribute("x1", res.x); cross.setAttribute("x2", res.x); cross.setAttribute("opacity", 1);
    tip.innerHTML = res.html; tip.hidden = false;
    const left = res.x / fr.W * r.width, tw = tip.offsetWidth;
    tip.style.left = (left + 12 + tw > r.width ? left - tw - 12 : left + 12) + "px"; tip.style.top = "6px";
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("opacity", 0); });
}

// series: [{ name, color, w, pts: [[시각, 값]...] }]
export function drawLine(el, { series, yFmt, tipFmt, H = 260 }) {
  const pts = series.flatMap(s => s.pts);
  if (!pts.length) { el.innerHTML = '<p class="empty">표시할 관측이 없습니다.</p>'; return; }
  let lo = Infinity, hi = -Infinity, xA = Infinity, xB = -Infinity;
  for (const [t, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; if (t < xA) xA = t; if (t > xB) xB = t; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const p = (hi - lo) * 0.06, fr = frame(el, H, lo - p, hi + p, yFmt, xA, xB);
  let body = fr.g;
  for (const s of series) {
    if (!s.pts.length) continue;
    const d = s.pts.map(([t, v], i) => (i ? "L" : "M") + fr.x(t).toFixed(1) + " " + fr.y(v).toFixed(1)).join("");
    const [et, ev] = s.pts[s.pts.length - 1];
    body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 1.6}" stroke-linejoin="round"/><circle cx="${fr.x(et)}" cy="${fr.y(ev)}" r="3.2" fill="${s.color}"/>`;
  }
  body += `<line class="cross" y1="${fr.T}" y2="${fr.H - fr.B}" stroke="var(--muted)" stroke-dasharray="3 3" opacity="0"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${fr.W} ${fr.H}" role="img" aria-label="추이 그래프">${body}</svg>`;
  const ref = series.find(s => s.pts.length).pts;
  attachTip(el, fr, px => {
    const t = xA + (px - fr.L) / (fr.W - fr.L - fr.R) * (xB - xA);
    let j = 0, best = Infinity; ref.forEach((q, i) => { const d = Math.abs(q[0] - t); if (d < best) { best = d; j = i; } });
    const tt = ref[j][0];
    const rows = series.map(s => { const q = s.pts.find(q => q[0] === tt); return q ? `<div><span style="color:${s.color}">●</span> ${s.name} <span class="num">${(tipFmt || yFmt)(q[1])}</span></div>` : ""; }).join("");
    return { x: fr.x(tt), html: `<div class="num">${md(tt)} ${hm(tt)}</div>${rows}` };
  });
}

// cs: [{ t0, t1, o, h, l, c }] 표차 캔들
export function drawCandles(el, cs, H = 260) {
  if (!cs.length) { el.innerHTML = '<p class="empty">표시할 관측이 없습니다.</p>'; return; }
  let lo = Infinity, hi = -Infinity; for (const c of cs) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const p = (hi - lo) * 0.06, xA = cs[0].t0, xB = cs[cs.length - 1].t1;
  const fr = frame(el, H, lo - p, hi + p, man, xA, xB);
  const bw = (fr.W - fr.L - fr.R) / cs.length, w = Math.max(1, bw * 0.64);
  let body = fr.g;
  cs.forEach((c, i) => {
    const cx = fr.L + bw * (i + 0.5), col = c.c >= c.o ? "var(--up)" : "var(--down)";
    const y1 = fr.y(Math.max(c.o, c.c)), y2 = fr.y(Math.min(c.o, c.c));
    body += `<line x1="${cx}" x2="${cx}" y1="${fr.y(c.h)}" y2="${fr.y(c.l)}" stroke="${col}" stroke-width="1"/><rect x="${cx - w / 2}" y="${y1}" width="${w}" height="${Math.max(1, y2 - y1)}" fill="${col}"/>`;
  });
  body += `<line class="cross" y1="${fr.T}" y2="${fr.H - fr.B}" stroke="var(--muted)" stroke-dasharray="3 3" opacity="0"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${fr.W} ${fr.H}" role="img" aria-label="표차 캔들 차트">${body}</svg>`;
  attachTip(el, fr, px => {
    const i = clamp(Math.floor((px - fr.L) / bw), 0, cs.length - 1), c = cs[i], d = c.c - c.o;
    return { x: fr.L + bw * (i + 0.5), html: `<div class="num">${md(c.t0)} ${hm(c.t0)}–${hm(c.t1)}</div><div>시가 <span class="num">${fmt(c.o)}</span> · 종가 <span class="num">${fmt(c.c)}</span></div><div>고가 <span class="num">${fmt(c.h)}</span> · 저가 <span class="num">${fmt(c.l)}</span></div><div>변화 <span class="num">${signed(d)}</span></div>` };
  });
}
