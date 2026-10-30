// 이미지 공유: 데이터로 직접 그린 PNG(순위표·현황표), 화면 차트를 옮긴 PNG, 게시판용 HTML(표만, 이미지 없음).
// 공유창에서 이미지 복사 · PNG 다운로드 · (휴대폰) 공유하기 · 게시판용 HTML 복사를 고른다.
import { fmt, f2, gapLabel, signed, esc } from "./format.js";

const FONTS = {
  body: '"IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif',
  num: '"IBM Plex Mono",ui-monospace,Consolas,monospace',
  disp: '"Barlow Condensed","IBM Plex Sans KR","Malgun Gothic",sans-serif'
};
const W = 760, PAD = 28, HTML_LIMIT = 65535;

function palette() {
  const s = getComputedStyle(document.documentElement), v = n => s.getPropertyValue(n).trim();
  return { bg: v("--bg"), surface: v("--surface"), sunk: v("--sunk"), ink: v("--ink"), muted: v("--muted"), line: v("--line"),
    melon: v("--melon"), berriz: v("--berriz"), up: v("--up"), down: v("--down"), base: v("--base"), pin: v("--pin"),
    cut: v("--cut") || v("--ink"), cutInk: v("--cut-ink") || v("--surface") };
}

/* ───────── 그리기 목록 → 캔버스 ───────── */
class Doc {
  constructor() { this.ops = []; }
  text(x, y, s, { size = 14, weight = 400, family = "body", color, align = "left", maxW } = {}) {
    this.ops.push({ k: "t", x, y, s: String(s), font: `${weight} ${size}px ${FONTS[family]}`, color, align, maxW });
  }
  rect(x, y, w, h, color, r = 0) { this.ops.push({ k: "r", x, y, w, h, color, r }); }
  line(x1, y1, x2, y2, color, w = 1) { this.ops.push({ k: "l", x1, y1, x2, y2, color, w }); }
  image(img, x, y, w, h) { this.ops.push({ k: "i", img, x, y, w, h }); }
}

async function paint(doc, height, bg) {
  // 쓰는 글자의 웹폰트 조각만 미리 불러온다(한글 폰트는 글자 범위별로 나뉘어 있음)
  const byFont = new Map();
  for (const o of doc.ops) if (o.k === "t") byFont.set(o.font, (byFont.get(o.font) || "") + o.s);
  await Promise.all([...byFont].map(([f, s]) => document.fonts.load(f, s).catch(() => {})));
  const scale = 2, c = document.createElement("canvas");
  c.width = W * scale; c.height = Math.ceil(height * scale);
  const g = c.getContext("2d");
  g.scale(scale, scale);
  g.fillStyle = bg; g.fillRect(0, 0, W, height);
  g.textBaseline = "alphabetic";
  for (const o of doc.ops) {
    if (o.k === "t") { g.font = o.font; g.fillStyle = o.color; g.textAlign = o.align; o.maxW ? g.fillText(o.s, o.x, o.y, o.maxW) : g.fillText(o.s, o.x, o.y); }
    else if (o.k === "r") { g.fillStyle = o.color; g.beginPath(); g.roundRect ? g.roundRect(o.x, o.y, o.w, o.h, o.r) : g.rect(o.x, o.y, o.w, o.h); g.fill(); }
    else if (o.k === "l") { g.strokeStyle = o.color; g.lineWidth = o.w; g.beginPath(); g.moveTo(o.x1, o.y1); g.lineTo(o.x2, o.y2); g.stroke(); }
    else if (o.k === "i") g.drawImage(o.img, o.x, o.y, o.w, o.h);
  }
  return c;
}

function header(doc, c, m) {
  doc.text(PAD, 48, m.title, { size: 28, weight: 600, family: "disp", color: c.ink, maxW: W - PAD * 2 - (m.sample ? 110 : 0) });
  doc.text(PAD, 72, m.sub, { size: 13, color: c.muted, maxW: W - PAD * 2 });
  if (m.sample) { doc.rect(W - PAD - 96, 28, 96, 24, c.sunk, 5); doc.text(W - PAD - 48, 45, "예시 데이터", { size: 12, weight: 600, color: c.ink, align: "center" }); }
  return 92;
}
function footer(doc, c, y, note) {
  doc.line(PAD, y, W - PAD, y, c.line);
  doc.text(PAD, y + 22, note, { size: 12, color: c.muted, maxW: W - PAD * 2 - 220 });
  doc.text(W - PAD, y + 22, location.host, { size: 12, color: c.muted, align: "right", family: "num" });
  return y + 36;
}

/* ───────── 표 그리기(순위표·현황표 공통) ───────── */
// cols: [{ label, x, align, w(이름 칸 최대 폭), get(row) → 문자열 또는 {s, color, weight, family} }]
function drawTable(doc, c, y, cols, rows, { cutoff = 0, rowH = 30 } = {}) {
  doc.rect(PAD, y, W - PAD * 2, 28, c.sunk, 4);
  for (const col of cols) doc.text(col.x, y + 19, col.label, { size: 11.5, weight: 600, color: c.muted, align: col.align || "left" });
  y += 28;
  rows.forEach((r, i) => {
    if (r.pin) doc.rect(PAD, y, W - PAD * 2, rowH, c.pin);
    for (const col of cols) {
      let v = col.get(r); if (v == null) continue;
      if (typeof v !== "object") v = { s: v };
      doc.text(col.x, y + rowH / 2 + 5, v.s, { size: v.size || 13.5, weight: v.weight || 400, family: v.family || "num", color: v.color || c.ink, align: col.align || "left", maxW: col.w });
    }
    y += rowH;
    if (cutoff && i === cutoff - 1 && i < rows.length - 1) {
      // 컷 라인은 행 사이에 따로 띠를 두어 글자와 겹치지 않게 한다
      const my = y + 8;
      doc.line(PAD, my, W - PAD, my, c.cut, 2);
      doc.rect(W - PAD - 58, my - 8, 58, 16, c.cut, 3);
      doc.text(W - PAD - 29, my + 4, "TOP 10", { size: 10, weight: 600, color: c.cutInk, align: "center" });
      y += 16;
    } else doc.line(PAD, y, W - PAD, y, c.line);
  });
  return y;
}

/* ───────── 글로벌 순위표 ───────── */
// m: { title, sub, sample, cutoff, note, rows: [{ rank, change, name, chart, ms, bs, total, gap, pin }] }
export async function rankImage(m) {
  const c = palette(), doc = new Doc();
  let y = header(doc, c, m) + 6;
  const chg = d => d == null ? { s: "–", color: c.muted } : d > 0 ? { s: "▲" + d, color: c.up, size: 12 } : d < 0 ? { s: "▼" + -d, color: c.down, size: 12 } : { s: "–", color: c.muted };
  // chartLabel 이 null 이면 음원 열 없이(투표 점수만 합산하는 동안) 그린다
  const withChart = m.chartLabel !== null, dx = withChart ? 0 : -40;
  y = drawTable(doc, c, y, [
    { label: "순위", x: 58, align: "right", get: r => ({ s: r.rank ?? "–", family: "disp", weight: 600, size: 18 }) },
    { label: "변동", x: 70, get: r => chg(r.change) },
    { label: "후보", x: 112, w: 170, get: r => ({ s: r.name, family: "body", weight: 500 }) },
    ...(withChart ? [{ label: m.chartLabel || "음원", x: 360, align: "right", get: r => f2(r.chart) }] : []),
    // 방식 2(m.combined): 멜론·베리즈 점수 대신 두 사이트 합산 표수와 그 표로 환산한 투표 점수
    ...(m.combined ? [
      { label: "합산 표수", x: 460 + dx, align: "right", get: r => ({ s: r.sum == null ? "—" : fmt(r.sum), color: c.muted }) },
      { label: `투표(${m.voteMax})`, x: 540 + dx, align: "right", get: r => f2(r.vote) }
    ] : [
      { label: "멜론", x: 440 + dx, align: "right", get: r => ({ s: f2(r.ms), color: c.melon }) },
      { label: "베리즈", x: 520 + dx, align: "right", get: r => ({ s: f2(r.bs), color: c.berriz }) }
    ]),
    { label: withChart ? "합산" : "투표 합산", x: 620 + dx / 2, align: "right", get: r => ({ s: f2(r.total), weight: 500 }) },
    { label: "앞 순위와", x: W - PAD - 8, align: "right", get: r => r.gap != null ? { s: gapLabel(r.gap), color: c.muted } : { s: r.rank === 1 ? "선두" : "—", color: c.muted, family: "body" } }
  ], m.rows, { cutoff: m.cutoff });
  y = footer(doc, c, y + 18, m.note);
  return paint(doc, y, c.surface);
}

/* ───────── 사이트 현황표 ───────── */
// m: { title, sub, sample, note, site: "melon"|"berriz", rows: [{ rank, name, votes, share, gap, h1, score, pin }] }
export async function siteImage(m) {
  const c = palette(), doc = new Doc(), sc = c[m.site] || c.ink;
  let y = header(doc, c, m);
  doc.rect(PAD, y - 4, 40, 4, sc);
  y += 8;
  y = drawTable(doc, c, y, [
    { label: "순위", x: 58, align: "right", get: r => ({ s: r.rank, family: "disp", weight: 600, size: 18 }) },
    { label: "후보", x: 76, w: 170, get: r => ({ s: r.name, family: "body", weight: 500 }) },
    { label: "득표수", x: 380, align: "right", get: r => ({ s: fmt(r.votes), weight: 500 }) },
    { label: "점유율", x: 460, align: "right", get: r => r.share.toFixed(2) + "%" },
    { label: "앞 순위와", x: 560, align: "right", get: r => r.gap == null ? { s: "—", color: c.muted } : { s: "−" + fmt(r.gap), color: c.muted } },
    { label: "1시간", x: 650, align: "right", get: r => ({ s: signed(r.h1), color: sc }) },
    { label: "점수", x: W - PAD - 8, align: "right", get: r => f2(r.score) }
  ], m.rows);
  y = footer(doc, c, y + 18, m.note);
  return paint(doc, y, c.surface);
}

/* ───────── 차트(화면의 SVG를 그대로 옮김) ───────── */
async function svgImage(svg) {
  const css = getComputedStyle(document.documentElement), resolve = v => v.replace(/var\((--[\w-]+)\)/g, (_, n) => css.getPropertyValue(n).trim());
  const clone = svg.cloneNode(true), vb = svg.viewBox.baseVal;
  clone.querySelectorAll(".cross").forEach(n => n.remove());
  for (const n of [clone, ...clone.querySelectorAll("*")]) for (const a of [...n.attributes]) if (a.value.includes("var(")) n.setAttribute(a.name, resolve(a.value));
  clone.querySelectorAll("text").forEach(t => { t.setAttribute("font-family", "Consolas, Menlo, monospace"); t.setAttribute("font-size", "10.5"); t.setAttribute("fill", css.getPropertyValue("--muted").trim()); });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", vb.width); clone.setAttribute("height", vb.height);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  await img.decode();
  return { img, w: vb.width, h: vb.height };
}

// m: { title, sub, sample, note, legend: [{ name, color }], svg }
export async function chartImage(m) {
  const c = palette(), doc = new Doc();
  let y = header(doc, c, m) + 4;
  if (m.legend && m.legend.length) {
    let x = PAD;
    const g = document.createElement("canvas").getContext("2d");
    for (const l of m.legend) {
      g.font = `500 12.5px ${FONTS.body}`;
      const w = g.measureText(l.name).width + 22;
      if (x + w > W - PAD) { x = PAD; y += 22; }
      doc.rect(x, y + 3, 10, 10, l.color, 2);
      doc.text(x + 15, y + 12.5, l.name, { size: 12.5, weight: 500, color: c.ink });
      x += w + 10;
    }
    y += 28;
  }
  const { img, w, h } = await svgImage(m.svg), dw = W - PAD * 2, dh = h * dw / w;
  doc.image(img, PAD, y, dw, dh);
  y = footer(doc, c, y + dh + 14, m.note);
  return paint(doc, y, c.surface);
}

/* ───────── 게시판용 HTML(밝은 색 고정, 표만) ───────── */
const L = { ink: "#121a15", muted: "#59665e", line: "#d8dfda", sunk: "#e7ece8", pin: "#fff3c4", melon: "#00a03a", berriz: "#d3600c", up: "#d23434", down: "#2160cc" };
const td = (s, align = "left", extra = "") => `<td align="${align}" style="padding:5px 6px;border-bottom:1px solid ${L.line};white-space:nowrap;${extra}">${s}</td>`;
const th = (s, align = "left") => `<th align="${align}" style="padding:6px;font-size:12px;color:${L.muted};font-weight:bold;white-space:nowrap;">${s}</th>`;
function htmlBlock(m, head, body) {
  return `<div style="max-width:720px;font-family:'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif;color:${L.ink};font-size:14px;line-height:1.5;">`
    + `<p style="margin:0 0 2px;font-size:18px;"><b>${esc(m.title)}</b></p>`
    + `<p style="margin:0 0 10px;font-size:12px;color:${L.muted};">${esc(m.sub)}${m.sample ? " · 예시 데이터" : ""}</p>`
    + `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px;"><tr bgcolor="${L.sunk}" style="background:${L.sunk};">${head}</tr>${body}</table>`
    + `<p style="margin:8px 0 0;font-size:11px;color:${L.muted};">${esc(m.note)} · 복사 시점 기록 · <a href="${esc(location.origin)}/">${esc(location.host)}</a></p></div>`;
}
export function rankHTML(m) {
  const chg = d => d == null || d === 0 ? `<font color="${L.muted}">–</font>` : d > 0 ? `<font color="${L.up}">▲${d}</font>` : `<font color="${L.down}">▼${-d}</font>`;
  const withChart = m.chartLabel !== null;
  const body = m.rows.map((r, i) => {
    const bg = r.pin ? ` bgcolor="${L.pin}" style="background:${L.pin};"` : "", cut = m.cutoff && i === m.cutoff ? `border-top:2px solid ${L.ink};` : "";
    return `<tr${bg}>${td("<b>" + (r.rank ?? "–") + "</b>", "right", cut)}${td(chg(r.change), "left", cut)}${td("<b>" + esc(r.name) + "</b>", "left", cut)}${withChart ? td(f2(r.chart), "right", cut) : ""}${m.combined
      ? td(r.sum == null ? "—" : fmt(r.sum), "right", cut + `color:${L.muted};`) + td(f2(r.vote), "right", cut)
      : td(`<font color="${L.melon}">${f2(r.ms)}</font>`, "right", cut) + td(`<font color="${L.berriz}">${f2(r.bs)}</font>`, "right", cut)}${td("<b>" + f2(r.total) + "</b>", "right", cut)}${td(r.gap != null ? gapLabel(r.gap) : r.rank === 1 ? "선두" : "—", "right", cut + `color:${L.muted};`)}</tr>`;
  }).join("");
  return htmlBlock(m, th("순위", "right") + th("변동") + th("후보") + (withChart ? th(esc(m.chartLabel || "음원"), "right") : "") + (m.combined ? th("합산 표수", "right") + th(`투표(${m.voteMax})`, "right") : th("멜론", "right") + th("베리즈", "right")) + th(withChart ? "합산" : "투표 합산", "right") + th("앞 순위와", "right"), body);
}
export function siteHTML(m) {
  const sc = L[m.site] || L.ink;
  const body = m.rows.map(r => `<tr${r.pin ? ` bgcolor="${L.pin}" style="background:${L.pin};"` : ""}>${td("<b>" + r.rank + "</b>", "right")}${td("<b>" + esc(r.name) + "</b>")}${td("<b>" + fmt(r.votes) + "</b>", "right")}${td(r.share.toFixed(2) + "%", "right")}${td(r.gap == null ? "—" : "−" + fmt(r.gap), "right", `color:${L.muted};`)}${td(`<font color="${sc}">${signed(r.h1)}</font>`, "right")}${td(f2(r.score), "right")}</tr>`).join("");
  return htmlBlock(m, th("순위", "right") + th("후보") + th("득표수", "right") + th("점유율", "right") + th("앞 순위와", "right") + th("1시간", "right") + th("점수", "right"), body);
}

/* ───────── 공유창 ───────── */
let dlg, current = null, busy = false;
function ensureDialog() {
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.className = "share-dlg";
  dlg.innerHTML = `<div class="share-head"><h2>이미지 공유하기</h2><button type="button" class="btn" data-x aria-label="공유창 닫기">닫기</button></div>
    <div class="share-preview" aria-live="polite"></div>
    <p class="share-status" role="status"></p>
    <div class="share-actions">
      <button type="button" class="btn" data-a="native" hidden>공유하기</button>
      <button type="button" class="btn" data-a="copy" disabled>이미지 복사</button>
      <button type="button" class="btn" data-a="download" disabled>PNG 다운로드</button>
      <button type="button" class="btn" data-a="html" disabled>게시판용 HTML 복사</button>
    </div>
    <details class="share-src" hidden><summary>HTML 소스 보기</summary><textarea readonly aria-label="게시판용 HTML 소스"></textarea></details>`;
  document.body.appendChild(dlg);
  const st = s => { dlg.querySelector(".share-status").textContent = s; };
  dlg.addEventListener("click", async e => {
    if (e.target === dlg || e.target.closest("[data-x]")) { dlg.close(); return; }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a || !current) return;
    if (a === "download") {
      const url = URL.createObjectURL(current.blob), link = document.createElement("a");
      link.href = url; link.download = current.name + ".png"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      st("PNG를 저장했습니다.");
    } else if (a === "copy") {
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("no image clipboard");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": current.blob })]);
        st("이미지를 복사했습니다. 붙여넣기(Ctrl+V)로 올리세요.");
      } catch { st("이 브라우저는 이미지 복사를 지원하지 않습니다. PNG 다운로드나 공유하기를 쓰세요."); }
    } else if (a === "native") {
      try { await navigator.share({ files: [current.file], title: current.title }); }
      catch (err) { if (err && err.name !== "AbortError") st("공유하지 못했습니다. PNG 다운로드를 쓰세요."); }
    } else if (a === "html") {
      const ta = dlg.querySelector("textarea");
      try { await navigator.clipboard.writeText(current.html); st(`게시판용 HTML을 복사했습니다(${current.html.length.toLocaleString("ko-KR")}자). 게시판의 HTML 모드에 붙여넣으세요.`); }
      catch { dlg.querySelector(".share-src").open = true; ta.focus(); ta.select(); st("자동 복사가 막혀 있습니다. 선택된 소스를 Ctrl+C로 복사하세요."); }
    }
  });
  return dlg;
}

// make: async () => ({ canvas, name, title, html? })
export async function openShare(make) {
  if (busy) return;
  busy = true;
  const d = ensureDialog(), $ = s => d.querySelector(s);
  current = null;
  $(".share-preview").replaceChildren();
  $(".share-status").textContent = "이미지를 만드는 중…";
  d.querySelectorAll("[data-a]").forEach(b => { b.disabled = true; });
  $("[data-a=native]").hidden = true;
  $(".share-src").hidden = true;
  if (!d.open) d.showModal();
  try {
    const r = await make();
    const blob = await new Promise((ok, no) => r.canvas.toBlob(b => b ? ok(b) : no(new Error("PNG 변환 실패")), "image/png"));
    const file = new File([blob], r.name + ".png", { type: "image/png" });
    current = { ...r, blob, file };
    const img = new Image();
    img.alt = r.title + " 미리보기";
    img.src = URL.createObjectURL(blob);
    $(".share-preview").append(img);
    $("[data-a=copy]").disabled = $("[data-a=download]").disabled = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) { $("[data-a=native]").hidden = false; $("[data-a=native]").disabled = false; }
    if (r.html && r.html.length <= HTML_LIMIT) {
      $("[data-a=html]").disabled = false;
      $(".share-src").hidden = false;
      $("textarea").value = r.html;
      $(".share-status").textContent = "";
    } else $(".share-status").textContent = r.html ? "HTML이 너무 길어 이미지로만 공유할 수 있습니다." : "차트는 이미지로만 공유할 수 있습니다.";
  } catch (e) {
    console.error(e);
    $(".share-status").textContent = "이미지를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  } finally { busy = false; }
}
