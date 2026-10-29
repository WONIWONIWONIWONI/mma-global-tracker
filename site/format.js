// 화면 표시용 숫자·시각 형식
export const MIN = 60e3, HOUR = 3600e3, DAY = 864e5, KST = 9 * HOUR;
export const fmt = n => n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("ko-KR");
export const signed = n => n == null || !isFinite(n) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
export const f2 = n => n == null || !isFinite(n) ? "—" : n.toFixed(2);
export const man = v => { const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e4 ? s + (a / 1e4).toFixed(a >= 1e6 ? 0 : 1) + "만" : s + fmt(a); };
export const sum = a => a.reduce((x, y) => x + (y || 0), 0);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const kd = ts => new Date(ts + KST);
export const pad = n => String(n).padStart(2, "0");
export const hm = ts => { const d = kd(ts); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); };
export const hms = ts => { const d = kd(ts); return hm(ts) + ":" + pad(d.getUTCSeconds()); };
export const md = ts => { const d = kd(ts); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); };
export const mdK = ts => { const d = kd(ts); return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일"; };
export const midnight = ts => Math.floor((ts + KST) / DAY) * DAY - KST;
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
