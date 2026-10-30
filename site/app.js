// 화면. API 응답(점수 계산이 끝난 결과)을 받아 그리기만 한다.
import { USE_MOCK, REFRESH_MS, IDLE_MS } from "./settings.js";
import * as remote from "./remote.js";
import { MIN, HOUR, DAY, KST, fmt, signed, f2, fgap, gapLabel, man, sum, kd, pad, hm, hms, md, mdK, midnight, esc } from "./format.js";
import { drawLine, drawCandles } from "./charts.js";
import { openShare, rankImage, rankHTML, siteImage, siteHTML, chartImage } from "./share.js";
import { MAINTENANCE } from "./core/config.js";

const $ = s => document.querySelector(s);
// 차트 선 색은 테마(일반/다크)마다 style.css 의 --c1~--c8 에서 정한다
const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)", "var(--c8)"];
const VIEWS = ["global", "melon", "berriz"];
// 점검 중인 탭과 사이트(config.js MAINTENANCE). 내 컴퓨터의 가짜 데이터 미리보기에서는 모두 연다.
const CLOSED_TABS = USE_MOCK ? [] : MAINTENANCE.tabs, CLOSED_SITES = USE_MOCK ? [] : MAINTENANCE.sites;
const OPEN_VIEWS = VIEWS.filter(v => !CLOSED_TABS.includes(v));

/* ───────── 데이터 ───────── */
let P = null, CANDS = [], K = {}, RULES = null;
let nextFetch = 0, loading = false, loadError = null, refreshMs = REFRESH_MS;
let lastActive = Date.now(), paused = false;

async function fetchPayload() {
  if (USE_MOCK) return (await import("./core/mockApi.js")).getPayload(Date.now());
  return remote.loadRemote();
}
async function refresh() {
  if (loading) return;
  loading = true;
  try { apply(await fetchPayload()); loadError = null; }
  catch (e) { loadError = e; console.error(e); if (!P) $("#view-" + VIEW).innerHTML = '<p class="empty">데이터를 불러오지 못했습니다. 잠시 뒤 다시 시도합니다.</p>'; }
  finally {
    loading = false;
    // 서버가 정한 간격을 따르고, 여러 화면이 같은 순간에 몰리지 않게 간격의 1/4(최대 10초)까지 무작위로 더한다
    refreshMs = USE_MOCK ? REFRESH_MS : Math.max(REFRESH_MS, remote.serverRefreshSec * 1000);
    nextFetch = Date.now() + refreshMs + (USE_MOCK ? 0 : Math.random() * Math.min(10e3, refreshMs / 4));
    renderStatus();
  }
}

// 자리 비움: 조작이 없으면 갱신을 멈추고, 다시 움직이면 바로 최신값을 받는다
function activity() {
  const now = Date.now();
  if (now - lastActive < 1000 && !paused) return;
  lastActive = now;
  if (paused) { paused = false; refresh(); }
}
for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"]) addEventListener(ev, activity, { passive: true });
function apply(p) {
  const first = !P;
  P = p; RULES = p.config.rules;
  CANDS = p.config.candidates.map((c, k) => ({ ...c, k }));
  K = Object.fromEntries(CANDS.map(c => [c.id, c.k]));
  if (first) G.pin = K[p.config.pinDefault] ?? 0;
  render();
}

// 시계열에서 ts 시점에 알고 있던 값의 위치(없으면 -1)
function at(ser, ts) {
  const t = ser.t; let lo = 0, hi = t.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= ts) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
const vAt = (ser, k, ts) => { const i = at(ser, ts); return i < 0 ? null : ser.v[i][k]; };

/* ───────── 화면 상태 ───────── */
const G = { snap: "live", trend: "total", range: "all", pin: 0, sel: null };
const ST = {};
for (const key of ["melon", "berriz"]) ST[key] = { mode: "votes", range: "24h", sel: null, a: null, b: null, iv: "30m", hDate: null, dDate: null };
let VIEW = "global";
const openState = {};
const nameOf = k => esc(CANDS[k] ? CANDS[k].name : "?");
const muted = s => `<span class="muted">${s}</span>`;

// 후보 고르기 버튼. 후보가 많으면 상위 12팀과 선택한 팀만 보이고 "전체 보기"로 펼친다.
const CHIP_LIMIT = 12, chipsOpen = new Set();
function chipsHTML(order, sel, act) {
  const s = [...sel], all = chipsOpen.has(act) || order.length <= CHIP_LIMIT + 2;
  const shown = all ? order : order.filter((k, i) => i < CHIP_LIMIT || sel.has(k));
  const btn = k => { const n = s.indexOf(k); return `<button type="button" class="chip" data-chip="${act}" data-k="${k}" aria-pressed="${n >= 0}" style="--c:${n >= 0 ? PALETTE[n % PALETTE.length] : "var(--line)"}">${nameOf(k)}</button>`; };
  const more = order.length <= CHIP_LIMIT + 2 ? "" : `<button type="button" class="chip more" data-more="${act}">${all ? "접기" : `전체 ${order.length}팀 보기`}</button>`;
  return shown.map(btn).join("") + more;
}
function needHTML(n) {
  if (!n) return "—";
  if (n.type === "votes") return "+" + fmt(n.n) + "표";
  if (n.type === "top") return muted("1위 · 만점");
  if (n.type === "impossible") return muted("단독 불가");
  return muted("—");
}

/* ───────── 글로벌 TOP10 ───────── */
// 선택한 날짜(실시간 또는 00시 마감)의 순위 데이터. 화면과 공유 이미지가 같이 쓴다.
function globalData() {
  const L = P.live, snaps = P.snapshots.map(s => s.at);
  if (G.snap !== "live" && !snaps.includes(G.snap)) G.snap = "live";
  let data = null, prevRanks = null, cmp = "", when = "", hold = "";
  if (G.snap === "live") {
    if (!L) hold = "아직 두 사이트의 관측이 모두 모이지 않았습니다.";
    else {
      when = `실시간 · 멜론 ${hm(L.melonAt)} / 베리즈 ${hm(L.berrizAt)} 관측`;
      if (L.held) hold = `두 사이트의 관측 시각이 ${Math.round(L.skewMs / MIN)}분 벌어져 합산을 잠시 멈췄습니다. 수집이 정상으로 돌아오면 다시 표시합니다.`;
      else { data = L; prevRanks = L.compare && L.compare.ranks; if (prevRanks) cmp = "오늘 00시 대비"; }
    }
  } else {
    data = P.snapshots.find(s => s.at === G.snap); prevRanks = data.prevRanks; if (prevRanks) cmp = "전날 마감 대비";
    when = `${mdK(G.snap - 1)} 마감 · ${md(G.snap)} 00:00 관측`;
  }
  const R = data ? data.rows.map(r => ({ ...r, k: K[r.id] })) : null;
  return { snaps, R, prevRanks, cmp, when, hold };
}

function renderGlobal() {
  const v = $("#view-global"), CUT = RULES.cutoff, MAXT = RULES.provisionalMax;
  const { snaps, R, prevRanks, cmp, when, hold } = globalData();
  if (!G.sel) G.sel = new Set(R ? [R[0].k, R[1].k, R[CUT - 1].k, R[CUT].k, G.pin] : [0, 1, G.pin]);

  let cards = "", table = "";
  if (R) {
    const pin = R.find(r => r.k === G.pin);
    const pinNote = pin.rank == null ? "음원 점수 미확인 · 합산 순위 없음" : pin.rank <= CUT
      ? (pin.rank === 1 ? "선두" : `${pin.rank - 1}위와 ${f2(R[pin.rank - 2].total - pin.total)}점 차`) + ` · 11위와 ${f2(pin.total - R[CUT].total)}점 차`
      : `10위 ${esc(R[CUT - 1].name)}와 ${f2(R[CUT - 1].total - pin.total)}점 차`;
    const opts = CANDS.map(c => `<option value="${c.k}"${c.k === G.pin ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    // 음원 점수를 빼고 투표 점수만 합산하는 동안은 카드 위에 기준을 크게 적는다(캡처로 퍼질 때 오해 방지)
    const basis = RULES.useChart ? "" : `<p class="basis"><b>투표 점수 기준</b> 멜론 ${RULES.siteMax} + 베리즈 ${RULES.siteMax} = ${MAXT}점 만점 · 음원 ${RULES.chartMax}점·심사 ${RULES.judgeScore}점 미반영으로 최종 순위와 다를 수 있음</p>`;
    cards = `${basis}<div class="cards">
      <div class="card first"><span class="k">1위 (${RULES.useChart ? "잠정" : "투표 점수"})</span><span class="n">${esc(R[0].name)}</span><span class="v">${f2(R[0].total)}<small>/ ${MAXT}</small></span><span class="s">2위 ${esc(R[1].name)}보다 ${fgap(R[0].total - R[1].total)}점 앞섬</span></div>
      <div class="card cut"><span class="k">TOP10 컷${RULES.useChart ? "" : " (투표 점수)"}</span>
        <span class="cutpair"><span><i>10위</i><b>${esc(R[CUT - 1].name)}</b><em>${f2(R[CUT - 1].total)}</em></span><span><i>11위</i><b>${esc(R[CUT].name)}</b><em>${f2(R[CUT].total)}</em></span></span>
        <span class="v">${fgap(R[CUT - 1].total - R[CUT].total)}<small>점 차</small></span></div>
      <div class="card"><span class="k">관심 후보</span><span class="n">${esc(pin.name)}${pin.rank != null ? " · " + pin.rank + "위" : ""}</span><span class="v">${f2(pin.total)}<small>/ ${MAXT}</small></span><span class="s">${pinNote}</span>
        <select id="pinSel" aria-label="관심 후보 선택">${opts}</select></div>
    </div>`;

    // 넓은 화면은 표, 좁은 화면(휴대폰)은 한 줄 요약 목록(누르면 득표수·역전 필요 표가 펼쳐짐)을 보여 준다
    const est = RULES.chartEstimated ? "(예측)" : "", UC = RULES.useChart;   // UC false: 투표 점수만 합산(음원 열 없음)
    const votes = x => x == null ? "관측 없음" : fmt(x) + "표";
    // 한 사이트라도 값이 없으면 그 사이트 점수가 0으로 계산되므로 이름 옆에 표시한다
    const noVal = r => r.mv == null || r.bv == null ? ` <em class="warn" title="${r.mv == null ? "멜론" : "베리즈"} 값이 없어 0점으로 계산됨">값 없음</em>` : "";
    const UNRANKED = "음원 점수 미확인 · 합산 순위 없음";
    let rows = "", mrows = "";
    R.forEach((r, i) => {
      let ch = r.rank == null ? "" : muted("–");
      if (prevRanks && prevRanks[r.id] != null && r.rank != null) { const d = prevRanks[r.id] - r.rank; if (d > 0) ch = `<span class="up">▲${d}</span>`; else if (d < 0) ch = `<span class="down">▼${-d}</span>`; }
      if (r.rank == null && (i === 0 || R[i - 1].rank != null)) {
        rows += `<tr class="sep"><td colspan="${UC ? 10 : 9}">${UNRANKED}</td></tr>`;
        mrows += `<li class="sep">${UNRANKED}</li>`;
      }
      const gapTxt = r.gapAhead != null ? gapLabel(r.gapAhead) : r.rank === 1 ? "선두" : "";
      rows += `<tr class="${r.k === G.pin ? "pin" : ""}">
        <td class="r">${r.rank ?? muted("–")}</td><td class="ch">${ch}</td><td class="nm">${esc(r.name)}${noVal(r)}</td>
        ${UC ? `<td class="num">${f2(r.chart)}</td>` : ""}
        <td class="num">${f2(r.ms)}<span class="sub">${votes(r.mv)}</span></td>
        <td class="num">${f2(r.bs)}<span class="sub">${votes(r.bv)}</span></td>
        <td><div class="tot"><span class="stack" aria-hidden="true"><i style="width:${(r.chart || 0) / MAXT * 100}%;background:var(--base)"></i><i style="width:${r.ms / MAXT * 100}%;background:var(--melon)"></i><i style="width:${r.bs / MAXT * 100}%;background:var(--berriz)"></i></span><b>${f2(r.total)}</b></div></td>
        <td class="num">${r.gapAhead != null ? gapTxt : muted(gapTxt || "—")}</td>
        <td class="num">${needHTML(r.needMelon)}</td>
        <td class="num">${needHTML(r.needBerriz)}</td></tr>`;
      const oid = "rm-" + r.id;
      mrows += `<li class="${r.k === G.pin ? "pin" : ""}"><details id="${oid}"${openState[oid] ? " open" : ""}><summary>
        <span class="r">${r.rank ?? "–"}</span><span class="ch">${ch}</span>
        <span class="nm">${esc(r.name)}${noVal(r)}<small>${UC ? f2(r.chart) + " + " : ""}<em class="mc">${f2(r.ms)}</em> + <em class="bc">${f2(r.bs)}</em></small></span>
        <span class="tt"><b class="num">${f2(r.total)}</b><small class="num">${gapTxt}</small></span></summary>
        <div class="more"><div>멜론 ${votes(r.mv)} · 베리즈 ${votes(r.bv)}</div>
          ${r.gapAhead != null ? `<div>앞 순위를 넘으려면 · 멜론만 ${needHTML(r.needMelon)} · 베리즈만 ${needHTML(r.needBerriz)}</div>` : ""}</div></details></li>`;
      if (r.rank === CUT) {
        rows += `<tr class="cut" aria-hidden="true"><td colspan="${UC ? 10 : 9}"><span>TOP 10</span></td></tr>`;
        mrows += `<li class="cut" aria-hidden="true"><span>TOP 10</span></li>`;
      }
    });
    table = `<div class="tscroll rank-wide"><table class="rank">
      <thead><tr><th>순위</th><th>변동</th><th>후보</th>${UC ? `<th>음원${est}</th>` : ""}<th>멜론</th><th>베리즈</th><th>${UC ? "합산" : "투표 합산"}</th><th>앞 순위와</th><th>역전 · 멜론만</th><th>역전 · 베리즈만</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <ol class="rank-m">${mrows}</ol>
      <p class="hint-m">작은 숫자는 ${UC ? `음원${est} + ` : ""}<em class="mc">멜론</em> + <em class="bc">베리즈</em> 점수입니다. 줄을 누르면 득표수와 역전에 필요한 표가 보입니다.</p>
      <div class="legend">${UC ? `<span><i style="background:var(--base)"></i>음원 점수${est || "(고정)"}</span>` : ""}<span><i style="background:var(--melon)"></i>멜론 투표 ${RULES.siteMax}점</span><span><i style="background:var(--berriz)"></i>베리즈 투표 ${RULES.siteMax}점</span></div>`;
  } else table = `<p class="hold">${hold}</p>`;

  const snapOpts = snaps.slice().reverse().map(d => `<option value="${d}"${G.snap === d ? " selected" : ""}>${mdK(d - 1)} 마감 (${md(d)} 00시)</option>`).join("");
  v.innerHTML = `${cards}
  <div class="panel">
    <div class="phead"><div><h2>${G.snap === "live" ? (RULES.useChart ? "실시간 잠정 순위" : "실시간 투표 점수 순위") : mdK(G.snap - 1) + " 마감 순위"}</h2><p>${when}${cmp ? " · 변동은 " + cmp : ""}</p></div>
      <div class="ctrl"><label class="lbl" for="snapSel">날짜</label><select id="snapSel"><option value="live">실시간</option>${snapOpts}</select>${R ? shareBtn("g-rank") : ""}</div></div>
    ${table}
    <p class="note">${RULES.useChart
      ? `${RULES.chartEstimated ? "음원 점수는 공식 발표 전 예측값입니다. " : ""}심사 점수 ${RULES.judgeScore}점은 공개되지 않아 빠져 있습니다. 합산은 ${MAXT}점 만점 기준의 잠정 순위입니다.`
      : `<b>투표 점수만 합산한 ${MAXT}점 만점 순위입니다.</b> 실제 결과에 들어가는 음원 점수 ${RULES.chartMax}점과 심사 점수 ${RULES.judgeScore}점은 빠져 있어 최종 순위와 다를 수 있습니다.`} 투표 점수는 각 사이트 1위 득표수 대비 비율로 ${RULES.siteMax}점을 나눕니다. 역전에 필요한 표는 다른 후보 표가 그대로일 때 한 사이트에서만 더 받는 경우의 계산입니다.</p>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>점수 추이</h2><p>10분 간격 관측으로 다시 계산한 합산 점수</p></div>
      <div class="ctrl">
        <span class="seg">${[["total", "합산 점수"], ["g12", "1·2위 차"], ["cut", "10·11위 차"]].map(([k, l]) => `<button type="button" data-g="trend" data-v="${k}" aria-pressed="${G.trend === k}">${l}</button>`).join("")}</span>
        <span class="seg">${[["24h", "24시간"], ["all", "전체"]].map(([k, l]) => `<button type="button" data-g="range" data-v="${k}" aria-pressed="${G.range === k}">${l}</button>`).join("")}</span>
        ${shareBtn("g-trend")}
      </div></div>
    ${G.trend === "total" ? `<div class="chips">${chipsHTML(R ? R.map(r => r.k) : CANDS.map(c => c.k), G.sel, "gsel")}</div>` : ""}
    <div class="chart" id="g-chart"></div>
  </div>`;

  const T = P.trend, lastT = T.t[T.t.length - 1], from = G.range === "24h" ? lastT - DAY : -Infinity;
  const keep = T.t.map((t, i) => t >= from ? i : -1).filter(i => i >= 0);
  let series;
  const valid = p => p[1] != null;
  if (G.trend === "total") series = [...G.sel].map((k, n) => ({ name: nameOf(k), color: PALETTE[n % PALETTE.length], w: k === G.pin ? 2.4 : 1.6, pts: keep.map(i => [T.t[i], T.totals[k][i]]).filter(valid) }));
  else { const arr = G.trend === "g12" ? T.g12 : T.gcut; series = [{ name: G.trend === "g12" ? "1·2위 점수차" : "10·11위 점수차", color: "var(--ink)", w: 2, pts: keep.map(i => [T.t[i], arr[i]]).filter(valid) }]; }
  drawLine($("#g-chart"), { series, yFmt: x => x.toFixed(G.trend === "total" ? 0 : 1), tipFmt: x => x.toFixed(2) + "점" });
}

/* ───────── 사이트별 화면 ───────── */
function buildCandles(ser, a, b, iv) {
  const bucket = { "5m": 5, "30m": 30, "1h": 60, "1d": 1440 }[iv] * MIN, maxN = { "5m": 72, "30m": 96, "1h": 120, "1d": 60 }[iv];
  const out = []; let cur = null, prevC = null, key = null;
  for (let i = 0; i < ser.t.length; i++) {
    const va = ser.v[i][a], vb = ser.v[i][b];
    if (va == null || vb == null) continue;
    const t = ser.t[i], g = va - vb;
    if (prevC == null) { prevC = g; continue; }
    const kk = Math.floor((t + KST - 1) / bucket);   // 구간 끝 시각의 값은 그 구간의 종가
    if (kk !== key) { if (cur) out.push(cur); key = kk; const t0 = kk * bucket - KST; cur = { t0, t1: t0 + bucket, o: prevC, h: Math.max(prevC, g), l: Math.min(prevC, g), c: g }; }
    else { cur.h = Math.max(cur.h, g); cur.l = Math.min(cur.l, g); cur.c = g; }
    prevC = g;
  }
  if (cur) out.push(cur);
  return out.slice(-maxN);
}

// 사이트 최신 현황. 화면과 공유 이미지가 같이 쓴다. 관측이 없으면 null.
function siteData(key) {
  const s = P.sites[key];
  if (!s.latest || !s.series.t.length) return null;
  const ser = s.series, L = ser.t.length - 1, now = ser.t[L], start = ser.t[0];
  const vals = ser.v[L], total = sum(vals);
  const order = CANDS.map(c => c.k).sort((a, b) => (vals[b] ?? -1) - (vals[a] ?? -1));
  const back = ms => { const i = at(ser, now - ms); return i < 0 ? null : ser.v[i]; };
  // 직전 값: 멜론은 1분 전, 베리즈는 10분 전 집계(베리즈 시계열은 집계 사이를 같은 값으로 이어 둠)
  const h1 = back(HOUR), m1 = key === "berriz" ? back(10 * MIN) : L > 0 ? ser.v[L - 1] : null;
  const diff = (row, k) => row && row[k] != null && vals[k] != null ? vals[k] - row[k] : null;
  const share = k => total && vals[k] != null ? vals[k] / total * 100 : 0;
  return { s, ser, L, now, start, vals, total, order, back, h1, m1, diff, share };
}

function renderSite(key) {
  const S = ST[key], v = $("#view-" + key), D0 = siteData(key);
  if (!D0) { v.innerHTML = `<div class="panel"><p class="empty">${P.sites[key].name} 관측이 아직 없습니다.</p></div>`; return; }
  const { s, ser, L, now, start, vals, total, order, back, h1, m1, diff, share } = D0;
  if (!S.sel) S.sel = new Set([order[0], order[1], G.pin]);
  if (S.a == null) { S.a = order[0]; S.b = order[1]; }
  const ds = []; for (let d = midnight(start); d <= midnight(now); d += DAY) ds.push(d);
  if (!ds.includes(S.hDate)) S.hDate = ds[ds.length - 1];
  if (!ds.includes(S.dDate)) S.dDate = ds[ds.length - 1];
  const top = order[0], sec = order[1], gap = vals[top] - vals[sec];
  const gapH = h1 ? gap - (h1[top] - h1[sec]) : null;
  // 증가량. 음수(표가 줄어듦)는 사이트가 비정상 투표를 집계에서 뺀 경우라 오류로 보이지 않게 * 표시와 설명을 붙인다
  let adjusted = false;
  const inc = x => { if (x != null && x < 0) { adjusted = true; return `<span class="adj" title="사이트가 집계에서 표를 제외해 줄었습니다">${signed(x)}*</span>`; } return signed(x); };
  const card = (k, r) => `<div class="card${r === 1 ? " first" : ""}"><span class="k">${r}위</span><span class="n">${nameOf(k)}</span><span class="v num" style="font-family:var(--f-disp)">${fmt(vals[k])}</span><span class="s">점유율 ${share(k).toFixed(2)}% · ${key === "berriz" ? "직전 집계" : "직전 1분"} ${inc(diff(m1, k))} · 1시간 ${inc(diff(h1, k))}</span></div>`;

  // 전체 현황: 넓은 화면은 표, 휴대폰은 한 줄 목록(순위 · 이름/점유율·1시간 증가·점수 · 득표수/앞 순위와 차)
  const gapPrev = r => r ? "−" + fmt(vals[order[r - 1]] - vals[order[r]]) : "1위";
  const listRows = order.map((k, r) => `<tr${k === G.pin ? ' style="background:var(--pin)"' : ""}><td class="num">${r + 1}</td><td>${nameOf(k)}</td><td class="num">${fmt(vals[k])}</td><td class="num">${share(k).toFixed(2)}%</td><td class="num">${r ? gapPrev(r) : "—"}</td><td class="num">${inc(diff(h1, k))}</td><td class="num">${f2(s.scores[k])}</td></tr>`).join("");
  const listM = order.map((k, r) => `<li${k === G.pin ? ' class="pin"' : ""}><span class="r">${r + 1}</span>
    <span class="nm">${nameOf(k)}<small>${f2(s.scores[k])}점 · 1시간 ${inc(diff(h1, k))}</small></span>
    <span class="tt"><b class="num">${fmt(vals[k])}</b><small class="num">${gapPrev(r)}</small></span></li>`).join("");

  // 구간 [a, b) 증가량. 관측이 없는 구간은 null(0으로 채우지 않음)
  const incr = (k, a, b) => {
    if (b <= start || a >= now) return null;
    const x = vAt(ser, k, Math.min(b, now)), y = vAt(ser, k, Math.max(a, start));
    return x == null || y == null ? null : x - y;
  };

  /* 시간대별 · 날짜별 표: 넓은 화면은 상위 6팀 + 관심 후보, 휴대폰은 1·2위 + 관심 후보만 */
  // 표가 패널 폭 안에 들어오도록 화면 폭에 따라 보여 줄 팀 수를 정한다(옆으로 스크롤하지 않게)
  const narrow = matchMedia("(max-width: 640px)").matches, medium = !narrow && matchMedia("(max-width: 900px)").matches;
  const topN = narrow ? 2 : medium ? 4 : 6;
  const cols = [...new Set([...order.slice(0, topN), G.pin])];
  const colsNote = narrow ? "1·2위와 관심 후보" : `상위 ${topN}팀과 관심 후보`;
  const big = x => x == null ? "—" : narrow && Math.abs(x) >= 1e5 ? man(x) : fmt(x);
  const heatK = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--heat")) || 42;
  const D = S.hDate;
  let hmax = 1; const hrs = [];
  for (let h = 0; h < 24; h++) { const a = D + h * HOUR, b = a + HOUR, row = cols.map(k => incr(k, a, b)); row.forEach(x => { if (x != null && x > hmax) hmax = x; }); hrs.push({ h, a, b, row }); }
  const heatRows = hrs.filter(r => r.row.some(x => x != null)).map(r => { const cur = r.b > now && r.a <= now; return `<tr class="${cur ? "now" : ""}"><td class="num">${pad(r.h)}시${cur ? '<small class="muted dl">진행 중</small>' : ""}</td>${r.row.map(x => x == null ? "<td>—</td>" : `<td class="num" style="background:color-mix(in srgb,var(--site) ${Math.round(x / hmax * heatK)}%,transparent)">${big(x)}</td>`).join("")}</tr>`; }).join("");

  /* 일별 */
  const dayInc = d => CANDS.map(c => incr(c.k, d, d + DAY));
  const dd = dayInc(S.dDate), dOrder = CANDS.map(c => c.k).filter(k => dd[k] != null).sort((a, b) => dd[b] - dd[a]);
  const dShow = [...new Set([...dOrder.slice(0, 10), G.pin])].filter(k => dd[k] != null), dMax = Math.max(1, ...dShow.map(k => dd[k]));
  const dayState = d => d < start && d + DAY > start ? "첫날 · " + hm(start) + " 시작" : d + DAY > now ? "진행 중 · " + hm(now) + "까지" : "마감";
  const dayShort = d => d < start && d + DAY > start ? "첫날" : d + DAY > now ? "진행 중" : "마감";
  const dayTable = ds.slice().reverse().map(d => { const r = dayInc(d); return `<tr><td>${narrow ? `${md(d)}<small class="muted dl">${dayShort(d)}</small>` : `${mdK(d)}<small class="muted dl">${dayState(d)}</small>`}</td>${cols.map(k => `<td class="num">${big(r[k])}</td>`).join("")}<td class="num">${big(sum(r))}</td></tr>`; }).join("");
  const dateOpts = sel => ds.slice().reverse().map(d => `<option value="${d}"${d === sel ? " selected" : ""}>${mdK(d)}</option>`).join("");
  const candOpts = sel => order.map(k => `<option value="${k}"${k === sel ? " selected" : ""}>${nameOf(k)}</option>`).join("");

  /* 표차 */
  const gNow = vals[S.a] - vals[S.b];
  const gStat = m => { const r = back(m * MIN); if (!r || r[S.a] == null || r[S.b] == null) return "—"; const x = gNow - (r[S.a] - r[S.b]); return `<span class="${x > 0 ? "up" : x < 0 ? "down" : ""}">${signed(x)}</span>`; };

  v.innerHTML = `
  <div class="duel">${card(top, 1)}
    <div class="card gap"><span class="k">1·2위 표차</span><span class="v num" style="font-family:var(--f-disp)">${fmt(gap)}</span><span class="s">1시간 전보다 <span class="${gapH > 0 ? "up" : gapH < 0 ? "down" : ""}">${signed(gapH)}</span>${gapH > 0 ? " 벌어짐" : gapH < 0 ? " 좁혀짐" : ""}</span></div>
    ${card(sec, 2)}</div>
  <div class="panel">
    <div class="phead"><div><h2>${s.name} 전체 현황</h2><p>총 ${fmt(total)}표 · ${md(now)} ${hm(now)} 관측 · 점수는 이 사이트 1위 대비 ${RULES.siteMax}점 환산</p></div><div class="ctrl">${shareBtn(key + "-list")}</div></div>
    <div class="tscroll list-wide"><table class="list"><thead><tr><th>순위</th><th>후보</th><th>득표수</th><th>점유율</th><th>앞 순위와</th><th>1시간 증가</th><th>점수</th></tr></thead><tbody>${listRows}</tbody></table></div>
    <ol class="site-m">${listM}</ol>
    <p class="hint-m">작은 글씨는 이 사이트 점수(10점 만점)와 1시간 증가, 오른쪽 아래는 앞 순위와의 표 차이입니다.</p>
    ${adjusted ? `<p class="note">* 표가 줄어든 경우: ${s.name} 쪽에서 비정상 투표를 집계에서 제외한 것으로 보입니다(오류 아님).</p>` : ""}
  </div>
  <div class="panel">
    <div class="phead"><div><h2>득표 추이</h2><p>${S.mode === "votes" ? "누적 득표수" : "전체 득표 대비 점유율"} · 1분 관측</p></div>
      <div class="ctrl">
        <span class="seg">${[["votes", "득표수"], ["share", "득표율"]].map(([k, l]) => `<button type="button" data-s="${key}" data-f="mode" data-v="${k}" aria-pressed="${S.mode === k}">${l}</button>`).join("")}</span>
        <span class="seg">${[["6h", "6시간"], ["24h", "24시간"], ["all", "전체"]].map(([k, l]) => `<button type="button" data-s="${key}" data-f="range" data-v="${k}" aria-pressed="${S.range === k}">${l}</button>`).join("")}</span>
        ${shareBtn(key + "-line")}
      </div></div>
    <div class="chips">${chipsHTML(order, S.sel, key)}</div>
    <div class="chart" id="${key}-line"></div>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>표차 분석</h2><p>앞 후보 득표 − 뒤 후보 득표. 빨강은 격차 확대, 파랑은 격차 축소</p></div>
      <div class="ctrl">
        <select id="${key}-a" aria-label="앞 후보">${candOpts(S.a)}</select><span class="lbl">−</span><select id="${key}-b" aria-label="뒤 후보">${candOpts(S.b)}</select>
        <span class="seg">${[["5m", "5분"], ["30m", "30분"], ["1h", "1시간"], ["1d", "일"]].map(([k, l]) => `<button type="button" data-s="${key}" data-f="iv" data-v="${k}" aria-pressed="${S.iv === k}">${l}봉</button>`).join("")}</span>
        ${shareBtn(key + "-candle")}
      </div></div>
    <div class="stats"><div><div class="k">현재 표차</div><div class="v">${signed(gNow)}</div></div><div><div class="k">1시간 변화</div><div class="v">${gStat(60)}</div></div><div><div class="k">4시간 변화</div><div class="v">${gStat(240)}</div></div><div><div class="k">24시간 변화</div><div class="v">${gStat(1440)}</div></div></div>
    <div class="chart" id="${key}-candle"></div>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>시간대별 증가량</h2><p>${colsNote} · KST</p></div><div class="ctrl"><select id="${key}-hd" aria-label="날짜">${dateOpts(S.hDate)}</select></div></div>
    <table class="heat fit"><thead><tr><th>시간</th>${cols.map(k => `<th>${nameOf(k)}</th>`).join("")}</tr></thead><tbody>${heatRows || `<tr><td colspan="${cols.length + 1}">관측 없음</td></tr>`}</tbody></table>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>일일 득표량</h2><p>${dayState(S.dDate)} · 00시 기준</p></div><div class="ctrl"><select id="${key}-dd" aria-label="날짜">${dateOpts(S.dDate)}</select></div></div>
    <div class="bars">${dShow.map(k => `<div class="bar${k === G.pin ? " pin" : ""}"><span class="nm">${nameOf(k)}</span><span class="t"><i style="width:${dd[k] / dMax * 100}%"></i></span><span class="num" style="text-align:right">${fmt(dd[k])}</span></div>`).join("")}</div>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>날짜별 마감 기록</h2><p>${colsNote} · 각 날짜 00시부터 다음 날 00시까지의 증가량</p></div></div>
    <table class="heat fit day"><thead><tr><th>날짜</th>${cols.map(k => `<th>${nameOf(k)}</th>`).join("")}<th>전체</th></tr></thead><tbody>${dayTable}</tbody></table>
  </div>`;

  /* 추이 차트: 6시간은 1분, 24시간은 5분, 전체는 15분 간격 점 */
  const span = { "6h": 6 * HOUR, "24h": DAY, all: Infinity }[S.range], stp = { "6h": MIN, "24h": 5 * MIN, all: 15 * MIN }[S.range];
  const idx = [];
  for (let j = 0; j <= L; j++) { const t = ser.t[j]; if (now - t <= span && (j === 0 || j === L || t % stp === 0)) idx.push(j); }
  const tot = idx.map(j => sum(ser.v[j]));
  drawLine($("#" + key + "-line"), {
    series: [...S.sel].map((k, n) => ({ name: nameOf(k), color: PALETTE[n % PALETTE.length], w: k === G.pin ? 2.4 : 1.6,
      pts: idx.map((j, q) => [j, q]).filter(([j]) => ser.v[j][k] != null).map(([j, q]) => [ser.t[j], S.mode === "votes" ? ser.v[j][k] : (tot[q] ? ser.v[j][k] / tot[q] * 100 : 0)]) })),
    yFmt: S.mode === "votes" ? man : x => x.toFixed(1) + "%", tipFmt: S.mode === "votes" ? fmt : x => x.toFixed(2) + "%"
  });
  drawCandles($("#" + key + "-candle"), buildCandles(ser, S.a, S.b, S.iv));
}

/* ───────── 이미지 공유 ───────── */
const shareBtn = kind => `<button type="button" class="btn sbtn" data-share="${kind}">이미지 공유</button>`;
const stampOf = ts => `${mdK(ts)} ${hm(ts)}`;
const fileStamp = ts => { const d = kd(ts); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "-" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()); };
const rankNote = () => RULES.useChart
  ? `비공식 트래커 · ${RULES.chartEstimated ? "음원 점수 예측값 · " : ""}심사 ${RULES.judgeScore}점 미반영, ${RULES.provisionalMax}점 만점 잠정 순위`
  : `비공식 트래커 · 투표 점수(멜론 ${RULES.siteMax} + 베리즈 ${RULES.siteMax})만 합산, 음원 ${RULES.chartMax}점·심사 ${RULES.judgeScore}점 미반영`;
const IV_LABEL = { "5m": "5분봉", "30m": "30분봉", "1h": "1시간봉", "1d": "일봉" };

// kind: g-rank, g-trend, <site>-list, <site>-line, <site>-candle. 지금 화면에 보이는 선택(날짜·후보·구간)을 그대로 쓴다.
async function makeShare(kind) {
  if (kind === "g-rank") {
    const { R, prevRanks, when } = globalData();
    if (!R) throw new Error("순위 데이터 없음");
    const live = G.snap === "live", ts = live ? Math.max(P.live.melonAt, P.live.berrizAt) : G.snap;
    const m = {
      title: live ? (RULES.useChart ? "MMA 2026 글로벌 TOP10 잠정 순위" : "MMA 2026 글로벌 TOP10 투표 점수 순위") :`MMA 2026 글로벌 TOP10 · ${mdK(G.snap - 1)} 마감`,
      sub: when, sample: P.sample, cutoff: RULES.cutoff, note: rankNote(), chartLabel: !RULES.useChart ? null : RULES.chartEstimated ? "음원(예측)" : "음원",
      rows: R.map(r => ({ rank: r.rank, change: prevRanks && prevRanks[r.id] != null ? prevRanks[r.id] - r.rank : null, name: r.name,
        chart: r.chart, ms: r.ms, bs: r.bs, total: r.total, gap: r.gapAhead, pin: r.k === G.pin }))
    };
    return { canvas: await rankImage(m), html: rankHTML(m), title: m.title, name: `mma-top10-rank-${fileStamp(ts)}` };
  }
  const [key, part] = kind.split("-");
  if (part === "list") {
    const D = siteData(key);
    const m = {
      title: `${D.s.name} 투표 현황`, sub: `총 ${fmt(D.total)}표 · ${stampOf(D.now)} 관측`, sample: P.sample, site: key,
      note: `비공식 트래커 · 점수는 ${D.s.name} 1위 대비 ${RULES.siteMax}점 환산`,
      rows: D.order.map((k, i) => ({ rank: i + 1, name: CANDS[k].name, votes: D.vals[k], share: D.share(k),
        gap: i ? D.vals[D.order[i - 1]] - D.vals[k] : null, h1: D.diff(D.h1, k), score: D.s.scores[k], pin: k === G.pin }))
    };
    return { canvas: await siteImage(m), html: siteHTML(m), title: m.title, name: `mma-top10-${key}-${fileStamp(D.now)}` };
  }
  // 차트는 화면에 그려진 SVG를 그대로 옮긴다
  const panel = document.querySelector(`[data-share="${kind}"]`).closest(".panel"), svg = panel.querySelector(".chart svg");
  if (!svg) throw new Error("차트 없음");
  const h2 = panel.querySelector("h2").textContent, p = panel.querySelector(".phead p").textContent;
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim();
  let legend = [...panel.querySelectorAll('.chip[aria-pressed="true"]')].map(b => ({ name: b.textContent, color: getComputedStyle(b).getPropertyValue("--c").trim() }));
  let title, ts, note = "비공식 트래커";
  if (key === "g") {
    ts = P.trend.t[P.trend.t.length - 1]; note = rankNote();
    title = `MMA 2026 글로벌 TOP10 · ${G.trend === "total" ? "합산 점수 추이" : G.trend === "g12" ? "1·2위 점수차 추이" : "10·11위 점수차 추이"}`;
    if (G.trend !== "total") legend = [];
  } else {
    const D = siteData(key), S = ST[key]; ts = D.now;
    if (part === "candle") {
      title = `${D.s.name} 표차 · ${CANDS[S.a].name} − ${CANDS[S.b].name} · ${IV_LABEL[S.iv]}`;
      legend = [{ name: "격차 확대", color: col("--up") }, { name: "격차 축소", color: col("--down") }];
    } else title = `${D.s.name} ${h2}`;
  }
  const m = { title, sub: `${p} · ${stampOf(ts)} 기준`, sample: P.sample, legend, svg, note };
  return { canvas: await chartImage(m), title, name: `mma-top10-${kind}-${fileStamp(ts)}` };
}

/* ───────── 상태줄 · 렌더 · 이벤트 ───────── */
// 투표 기간 안내: 시작 전 / 마감까지 남은 시간 / 종료
function voteStatus(now) {
  const v = P.config.vote; if (!v) return "";
  const s = Date.parse(v.start), e = Date.parse(v.end);
  if (now < s) return `<span>투표 시작 전 · <b class="num">${md(s)} ${hm(s)}</b> 시작</span>`;
  if (now >= e) return "<span><b>투표 종료</b></span>";
  const left = e - now, d = Math.floor(left / DAY), h = Math.floor(left % DAY / HOUR), mi = Math.floor(left % HOUR / MIN);
  return `<span>마감까지 <b class="num">${d ? d + "일 " + h + "시간" : h ? h + "시간 " + mi + "분" : mi + "분"}</b></span>`;
}

// 상태줄: 매초 바뀌는 건 남은 초(#cd)뿐이라 그 숫자만 고친다. 나머지가 바뀔 때만 다시 그려 화면이 들썩이지 않게 한다.
let statusHTML = "";
function renderStatus() {
  const el = $("#status");
  if (!P) { el.textContent = loadError ? "데이터를 불러오지 못했습니다" : "불러오는 중…"; return; }
  const now = Date.now(), m = P.sites.melon, b = P.sites.berriz;
  const closed = k => CLOSED_SITES.includes(k);
  const site = (s, k) => closed(k) ? "<b>점검 중</b>" : s.latest
    ? `<b class="num">${hms(s.latest.observedAt)}</b>${s.latest.sourceAt ? ` <span class="hide-m">(사이트 집계 <b class="num">${hm(s.latest.sourceAt)}</b>)</span>` : ""}${s.stale ? ` <span class="warn">${Math.floor((now - s.latest.observedAt) / MIN)}분 전 값</span>` : ""}`
    : '<b class="warn">관측 없음</b>';
  const ok = !loadError && (closed("melon") || !m.stale) && (closed("berriz") || !b.stale);
  const html = `<span class="live${ok ? "" : " off"}"><i></i><b>멜론 20초 · 베리즈 10분 간격 수집</b></span>
    <span>멜론 ${site(m, "melon")}</span><span>베리즈 ${site(b, "berriz")}</span>
    ${P.live ? `<span class="hide-m">사이트 간 시각차 <b class="num">${P.live.skewMs < 120e3 ? Math.round(P.live.skewMs / 1000) + "초" : Math.round(P.live.skewMs / MIN) + "분"}</b></span>` : ""}
    ${paused
      ? '<button type="button" class="btn">자리 비움으로 갱신 멈춤 · 누르면 다시 시작</button>'
      : '<span>다음 갱신 <b class="num cd" id="cd"></b></span>'}
    ${voteStatus(now)}
    ${refreshMs > REFRESH_MS ? `<span class="warn">접속이 많아 ${refreshMs % 60e3 ? refreshMs / 1000 + "초" : refreshMs / 60e3 + "분"} 간격으로 갱신 중</span>` : ""}
    ${loadError ? '<span class="warn">최근 갱신 실패 · 이전 값 표시 중</span>' : ""}
    ${[m, b].filter(s => s.missing && s.missing.length).map(s => `<span class="warn" title="${esc(s.missing.join(", "))}">${s.name} ${s.missing.length}팀 값 없음(사이트 표기 변경 확인 중)</span>`).join("")}
    ${P.sample ? '<span class="sample">예시 데이터 · 투표 주소 공개 전 화면</span>' : ""}`;
  if (html !== statusHTML) { el.innerHTML = html; statusHTML = html; }
  const cd = el.querySelector("#cd");
  if (cd) cd.textContent = Math.max(0, Math.ceil((nextFetch - now) / 1000)) + "초";
}
function render() { if (P) { if (VIEW === "global") renderGlobal(); else renderSite(VIEW); } }
function show(view) {
  VIEW = OPEN_VIEWS.includes(view) ? view : OPEN_VIEWS[0];
  for (const k of VIEWS) { $("#view-" + k).hidden = k !== VIEW; $("#tab-" + k).setAttribute("aria-selected", k === VIEW); }
  try { if (location.hash !== "#" + VIEW) history.replaceState(null, "", location.search + "#" + VIEW); } catch (e) {}
  render();
}
// 점검 중인 탭: 잠그고 "점검 중" 표시. 누르면 안내만 띄운다.
for (const k of CLOSED_TABS) {
  const t = $("#tab-" + k);
  t.classList.add("closed"); t.setAttribute("aria-disabled", "true");
  t.insertAdjacentHTML("beforeend", '<em class="mt">점검 중</em>');
}
document.querySelector(".tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-view]"); if (!b) return;
  if (CLOSED_TABS.includes(b.dataset.view)) { toast("점검 중입니다. 준비되면 다시 열겠습니다."); return; }
  show(b.dataset.view);
});
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

document.querySelector("main").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.share) { const kind = b.dataset.share; openShare(() => makeShare(kind)); return; }
  if (b.dataset.more) { const a = b.dataset.more; chipsOpen.has(a) ? chipsOpen.delete(a) : chipsOpen.add(a); render(); return; }
  if (b.dataset.g) { G[b.dataset.g] = b.dataset.v; renderGlobal(); return; }
  if (b.dataset.s) { ST[b.dataset.s][b.dataset.f] = b.dataset.v; renderSite(b.dataset.s); return; }
  if (b.dataset.chip) {
    const set = b.dataset.chip === "gsel" ? G.sel : ST[b.dataset.chip].sel, k = +b.dataset.k;
    if (set.has(k)) { if (set.size > 1) set.delete(k); } else if (set.size < 8) set.add(k);
    render();
  }
});
document.querySelector("main").addEventListener("change", e => {
  const el = e.target, id = el.id;
  if (id === "snapSel") { G.snap = el.value === "live" ? "live" : +el.value; renderGlobal(); return; }
  if (id === "pinSel") { G.pin = +el.value; if (G.sel) G.sel.add(G.pin); for (const k in ST) if (ST[k].sel) ST[k].sel.add(G.pin); renderGlobal(); return; }
  const m = id.match(/^(melon|berriz)-(a|b|hd|dd)$/); if (!m) return;
  ST[m[1]][{ a: "a", b: "b", hd: "hDate", dd: "dDate" }[m[2]]] = +el.value; renderSite(m[1]);
});
document.addEventListener("toggle", e => { if (e.target.id) openState[e.target.id] = e.target.open; }, true);

// 자동 갱신: 보이는 탭에서만, 조작이 IDLE_MS 넘게 없으면 멈춤. 돌아오거나 움직이면 바로 갱신.
setInterval(() => {
  if (!document.hidden && !paused && !loading && Date.now() >= nextFetch) {
    if (Date.now() - lastActive > IDLE_MS) paused = true; else refresh();
  }
  renderStatus();
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  activity();
  if (!paused && Date.now() >= nextFetch) refresh();
});

let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(render, 150); }).observe(document.querySelector("main"));

/* 맨 위로 버튼: 화면 높이의 절반 넘게 내려가면 보인다 */
{
  const btn = $("#toTop");
  let shown = false, ticking = false;
  const update = () => {
    ticking = false;
    const want = scrollY > innerHeight * 0.5;
    if (want === shown) return;
    shown = want;
    if (want) { btn.hidden = false; requestAnimationFrame(() => btn.classList.add("show")); }
    else { btn.classList.remove("show"); setTimeout(() => { if (!shown) btn.hidden = true; }, 200); }
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  btn.addEventListener("click", () => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // 부드러운 스크롤이 느리거나 멈추는 브라우저도 있어, 0.9초 뒤에도 위가 아니면 바로 맨 위로
    setTimeout(() => { if (scrollY > 0) scrollTo(0, 0); }, 900);
  });
  update();
}

/* 테마 */
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
function syncThemeBtn() { $("#themeBtn").textContent = isDark() ? "일반" : "다크"; }
$("#themeBtn").addEventListener("click", () => { const t = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("mma-theme", t); } catch (e) {} syncThemeBtn(); render(); });
// 기기 설정의 다크 모드가 바뀌어도 표 색(진하기 등)을 다시 계산
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { syncThemeBtn(); render(); });
syncThemeBtn();

/* 요약 복사 */
function summary() {
  if (VIEW === "global") {
    const L = P.live;
    if (!L || L.held) return "MMA 2026 글로벌 TOP10: 지금은 합산을 보류 중입니다.";
    const CUT = RULES.cutoff;
    return [RULES.useChart
        ? `MMA 2026 글로벌 TOP10 잠정 순위 (${md(L.melonAt)} ${hm(L.melonAt)}, 심사 ${RULES.judgeScore}점 미반영)`
        : `MMA 2026 글로벌 TOP10 투표 점수 순위 (${md(L.melonAt)} ${hm(L.melonAt)}, ${RULES.provisionalMax}점 만점 · 음원·심사 미반영)`,
      ...L.rows.slice(0, CUT).map(r => `${r.rank}. ${r.name} ${f2(r.total)} (${RULES.useChart ? `음원 ${f2(r.chart)} + ` : ""}멜론 ${f2(r.ms)} + 베리즈 ${f2(r.bs)})`),
      `컷: 10위와 11위 ${f2(L.rows[CUT - 1].total - L.rows[CUT].total)}점 차`].join("\n");
  }
  const s = P.sites[VIEW]; if (!s.latest) return s.name + " 관측이 아직 없습니다.";
  const v = s.latest.votes, t = sum(v), o = CANDS.map(c => c.k).sort((a, b) => (v[b] ?? -1) - (v[a] ?? -1)), at0 = s.latest.observedAt;
  return [`${s.name} 투표 현황 (${md(at0)} ${hm(at0)})`, ...o.slice(0, 5).map((k, r) => `${r + 1}. ${CANDS[k].name} ${fmt(v[k])}표 (${(t ? v[k] / t * 100 : 0).toFixed(2)}%)`), `1·2위 표차 ${fmt(v[o[0]] - v[o[1]])}표`].join("\n");
}
function toast(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 1800); }
$("#copyBtn").addEventListener("click", () => {
  if (!P) return;
  const text = summary();
  navigator.clipboard.writeText(text).then(() => toast("요약을 복사했습니다"), () => {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;height:160px;z-index:30";
    document.body.appendChild(ta); ta.select(); toast("자동 복사가 막혀 있습니다. 선택된 글을 직접 복사해 주세요"); setTimeout(() => ta.remove(), 8000);
  });
});

show(location.hash.slice(1) || OPEN_VIEWS[0]);
refresh();
