// 화면. API 응답(점수 계산이 끝난 결과)을 받아 그리기만 한다.
import { USE_MOCK, REFRESH_MS } from "./settings.js";
import { loadRemote } from "./remote.js";
import { MIN, HOUR, DAY, KST, fmt, signed, f2, man, sum, pad, hm, hms, md, mdK, midnight, esc } from "./format.js";
import { drawLine, drawCandles } from "./charts.js";

const $ = s => document.querySelector(s);
const PALETTE = ["#e0542c", "#2d7ad6", "#159f6c", "#9a57cf", "#e09b00", "#0e9fae", "#d1336b", "#7a6a55"];
const VIEWS = ["global", "melon", "berriz"];

/* ───────── 데이터 ───────── */
let P = null, CANDS = [], K = {}, RULES = null;
let nextFetch = 0, loading = false, loadError = null;

async function fetchPayload() {
  if (USE_MOCK) return (await import("./core/mockApi.js")).getPayload(Date.now());
  return loadRemote();
}
async function refresh() {
  if (loading) return;
  loading = true;
  try { apply(await fetchPayload()); loadError = null; }
  catch (e) { loadError = e; console.error(e); if (!P) $("#view-" + VIEW).innerHTML = '<p class="empty">데이터를 불러오지 못했습니다. 잠시 뒤 다시 시도합니다.</p>'; }
  finally { loading = false; nextFetch = Date.now() + REFRESH_MS; renderStatus(); }
}
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

function chipsHTML(order, sel, act) {
  const s = [...sel];
  return order.map(k => { const n = s.indexOf(k); return `<button type="button" class="chip" data-chip="${act}" data-k="${k}" aria-pressed="${n >= 0}" style="--c:${n >= 0 ? PALETTE[n % PALETTE.length] : "var(--line)"}">${nameOf(k)}</button>`; }).join("");
}
function needHTML(n) {
  if (!n) return "—";
  if (n.type === "votes") return "+" + fmt(n.n) + "표";
  if (n.type === "top") return muted("1위 · 만점");
  if (n.type === "impossible") return muted("단독 불가");
  return muted("—");
}

/* ───────── 글로벌 TOP10 ───────── */
function renderGlobal() {
  const v = $("#view-global"), CUT = RULES.cutoff, MAXT = RULES.provisionalMax, L = P.live;
  const snaps = P.snapshots.map(s => s.at);
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
  if (!G.sel) G.sel = new Set(R ? [R[0].k, R[1].k, R[CUT - 1].k, R[CUT].k, G.pin] : [0, 1, G.pin]);

  let cards = "", table = "";
  if (R) {
    const pin = R.find(r => r.k === G.pin);
    const pinNote = pin.rank <= CUT
      ? (pin.rank === 1 ? "선두" : `${pin.rank - 1}위와 ${f2(R[pin.rank - 2].total - pin.total)}점 차`) + ` · 11위와 ${f2(pin.total - R[CUT].total)}점 차`
      : `10위 ${esc(R[CUT - 1].name)}와 ${f2(R[CUT - 1].total - pin.total)}점 차`;
    const opts = CANDS.map(c => `<option value="${c.k}"${c.k === G.pin ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    cards = `<div class="cards">
      <div class="card"><span class="k">1위 (잠정)</span><span class="n">${esc(R[0].name)}</span><span class="v">${f2(R[0].total)}<small>/ ${MAXT}</small></span><span class="s">2위 ${esc(R[1].name)}보다 ${f2(R[0].total - R[1].total)}점 앞섬</span></div>
      <div class="card"><span class="k">TOP10 컷</span><span class="n">10위 ${esc(R[CUT - 1].name)} · 11위 ${esc(R[CUT].name)}</span><span class="v">${f2(R[CUT - 1].total - R[CUT].total)}<small>점 차</small></span><span class="s">10위 ${f2(R[CUT - 1].total)}점 · 11위 ${f2(R[CUT].total)}점</span></div>
      <div class="card"><span class="k">관심 후보</span><span class="n">${esc(pin.name)} · ${pin.rank}위</span><span class="v">${f2(pin.total)}<small>/ ${MAXT}</small></span><span class="s">${pinNote}</span>
        <select id="pinSel" aria-label="관심 후보 선택">${opts}</select></div>
    </div>`;

    let rows = "";
    R.forEach((r, i) => {
      let ch = muted("–");
      if (prevRanks && prevRanks[r.id] != null) { const d = prevRanks[r.id] - r.rank; if (d > 0) ch = `<span class="up">▲${d}</span>`; else if (d < 0) ch = `<span class="down">▼${-d}</span>`; }
      const votes = x => x == null ? "관측 없음" : fmt(x) + "표";
      rows += `<tr class="${r.k === G.pin ? "pin" : ""}">
        <td class="r">${r.rank}</td><td class="ch">${ch}</td><td class="nm">${esc(r.name)}</td>
        <td class="num">${f2(r.chart)}</td>
        <td class="num">${f2(r.ms)}<span class="sub">${votes(r.mv)}</span></td>
        <td class="num">${f2(r.bs)}<span class="sub">${votes(r.bv)}</span></td>
        <td><div class="tot"><span class="stack" aria-hidden="true"><i style="width:${r.chart / MAXT * 100}%;background:var(--base)"></i><i style="width:${r.ms / MAXT * 100}%;background:var(--melon)"></i><i style="width:${r.bs / MAXT * 100}%;background:var(--berriz)"></i></span><b>${f2(r.total)}</b></div></td>
        <td class="num">${i ? "−" + f2(r.gapAhead) : muted("선두")}</td>
        <td class="num">${i ? needHTML(r.needMelon) : "—"}</td>
        <td class="num">${i ? needHTML(r.needBerriz) : "—"}</td></tr>`;
      if (r.rank === CUT) rows += `<tr class="cut" aria-hidden="true"><td colspan="10"><span>TOP 10</span></td></tr>`;
    });
    table = `<div class="tscroll"><table class="rank">
      <thead><tr><th>순위</th><th>변동</th><th>후보</th><th>음원</th><th>멜론</th><th>베리즈</th><th>합산</th><th>앞 순위와</th><th>역전 · 멜론만</th><th>역전 · 베리즈만</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="legend"><span><i style="background:var(--base)"></i>음원 점수(고정)</span><span><i style="background:var(--melon)"></i>멜론 투표 ${RULES.siteMax}점</span><span><i style="background:var(--berriz)"></i>베리즈 투표 ${RULES.siteMax}점</span></div>`;
  } else table = `<p class="hold">${hold}</p>`;

  const snapOpts = snaps.slice().reverse().map(d => `<option value="${d}"${G.snap === d ? " selected" : ""}>${mdK(d - 1)} 마감 (${md(d)} 00시)</option>`).join("");
  v.innerHTML = `${cards}
  <div class="panel">
    <div class="phead"><div><h2>${G.snap === "live" ? "실시간 잠정 순위" : mdK(G.snap - 1) + " 마감 순위"}</h2><p>${when}${cmp ? " · 변동은 " + cmp : ""}</p></div>
      <div class="ctrl"><label class="lbl" for="snapSel">날짜</label><select id="snapSel"><option value="live">실시간</option>${snapOpts}</select></div></div>
    ${table}
    <p class="note">심사 점수 ${RULES.judgeScore}점은 공개되지 않아 빠져 있습니다. 합산은 ${MAXT}점 만점 기준의 잠정 순위입니다. 투표 점수는 각 사이트 1위 득표수 대비 비율로 ${RULES.siteMax}점을 나눕니다. 역전에 필요한 표는 다른 후보 표가 그대로일 때 한 사이트에서만 더 받는 경우의 계산입니다.</p>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>점수 추이</h2><p>10분 간격 관측으로 다시 계산한 합산 점수</p></div>
      <div class="ctrl">
        <span class="seg">${[["total", "합산 점수"], ["g12", "1·2위 차"], ["cut", "10·11위 차"]].map(([k, l]) => `<button type="button" data-g="trend" data-v="${k}" aria-pressed="${G.trend === k}">${l}</button>`).join("")}</span>
        <span class="seg">${[["24h", "24시간"], ["all", "전체"]].map(([k, l]) => `<button type="button" data-g="range" data-v="${k}" aria-pressed="${G.range === k}">${l}</button>`).join("")}</span>
      </div></div>
    ${G.trend === "total" ? `<div class="chips">${chipsHTML(R ? R.map(r => r.k) : CANDS.map(c => c.k), G.sel, "gsel")}</div>` : ""}
    <div class="chart" id="g-chart"></div>
  </div>`;

  const T = P.trend, lastT = T.t[T.t.length - 1], from = G.range === "24h" ? lastT - DAY : -Infinity;
  const keep = T.t.map((t, i) => t >= from ? i : -1).filter(i => i >= 0);
  let series;
  if (G.trend === "total") series = [...G.sel].map((k, n) => ({ name: nameOf(k), color: PALETTE[n % PALETTE.length], w: k === G.pin ? 2.4 : 1.6, pts: keep.map(i => [T.t[i], T.totals[k][i]]) }));
  else { const arr = G.trend === "g12" ? T.g12 : T.gcut; series = [{ name: G.trend === "g12" ? "1·2위 점수차" : "10·11위 점수차", color: "var(--ink)", w: 2, pts: keep.map(i => [T.t[i], arr[i]]) }]; }
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

function renderSite(key) {
  const s = P.sites[key], S = ST[key], v = $("#view-" + key);
  if (!s.latest || !s.series.t.length) { v.innerHTML = `<div class="panel"><p class="empty">${s.name} 관측이 아직 없습니다.</p></div>`; return; }
  const ser = s.series, L = ser.t.length - 1, now = ser.t[L], start = ser.t[0];
  const vals = ser.v[L], total = sum(vals);
  const order = CANDS.map(c => c.k).sort((a, b) => (vals[b] ?? -1) - (vals[a] ?? -1));
  const back = ms => { const i = at(ser, now - ms); return i < 0 ? null : ser.v[i]; };
  const h1 = back(HOUR), m1 = L > 0 ? ser.v[L - 1] : null;
  const diff = (row, k) => row && row[k] != null && vals[k] != null ? vals[k] - row[k] : null;
  if (!S.sel) S.sel = new Set([order[0], order[1], G.pin]);
  if (S.a == null) { S.a = order[0]; S.b = order[1]; }
  const ds = []; for (let d = midnight(start); d <= midnight(now); d += DAY) ds.push(d);
  if (!ds.includes(S.hDate)) S.hDate = ds[ds.length - 1];
  if (!ds.includes(S.dDate)) S.dDate = ds[ds.length - 1];
  const share = k => total && vals[k] != null ? vals[k] / total * 100 : 0;
  const top = order[0], sec = order[1], gap = vals[top] - vals[sec];
  const gapH = h1 ? gap - (h1[top] - h1[sec]) : null;
  const card = (k, r) => `<div class="card"><span class="k">${r}위</span><span class="n">${nameOf(k)}</span><span class="v num" style="font-family:var(--f-disp)">${fmt(vals[k])}</span><span class="s">점유율 ${share(k).toFixed(2)}% · 직전 1분 ${signed(diff(m1, k))} · 1시간 ${signed(diff(h1, k))}</span></div>`;

  const listRows = order.map((k, r) => `<tr${k === G.pin ? ' style="background:var(--pin)"' : ""}><td class="num">${r + 1}</td><td>${nameOf(k)}</td><td class="num">${fmt(vals[k])}</td><td class="num">${share(k).toFixed(2)}%</td><td class="num">${r ? "−" + fmt(vals[order[r - 1]] - vals[k]) : "—"}</td><td class="num">${signed(diff(h1, k))}</td><td class="num">${f2(s.scores[k])}</td></tr>`).join("");

  // 구간 [a, b) 증가량. 관측이 없는 구간은 null(0으로 채우지 않음)
  const incr = (k, a, b) => {
    if (b <= start || a >= now) return null;
    const x = vAt(ser, k, Math.min(b, now)), y = vAt(ser, k, Math.max(a, start));
    return x == null || y == null ? null : x - y;
  };

  /* 시간대별 */
  const cols = [...new Set([...order.slice(0, 6), G.pin])];
  const D = S.hDate;
  let hmax = 1; const hrs = [];
  for (let h = 0; h < 24; h++) { const a = D + h * HOUR, b = a + HOUR, row = cols.map(k => incr(k, a, b)); row.forEach(x => { if (x != null && x > hmax) hmax = x; }); hrs.push({ h, a, b, row }); }
  const heatRows = hrs.filter(r => r.row.some(x => x != null)).map(r => { const cur = r.b > now && r.a <= now; return `<tr class="${cur ? "now" : ""}"><td class="num">${pad(r.h)}시${cur ? " · 진행 중" : ""}</td>${r.row.map(x => x == null ? "<td>—</td>" : `<td class="num" style="background:color-mix(in srgb,var(--site) ${Math.round(x / hmax * 42)}%,transparent)">${fmt(x)}</td>`).join("")}</tr>`; }).join("");

  /* 일별 */
  const dayInc = d => CANDS.map(c => incr(c.k, d, d + DAY));
  const dd = dayInc(S.dDate), dOrder = CANDS.map(c => c.k).filter(k => dd[k] != null).sort((a, b) => dd[b] - dd[a]);
  const dShow = [...new Set([...dOrder.slice(0, 10), G.pin])].filter(k => dd[k] != null), dMax = Math.max(1, ...dShow.map(k => dd[k]));
  const dayState = d => d < start && d + DAY > start ? "첫날 · " + hm(start) + " 시작" : d + DAY > now ? "진행 중 · " + hm(now) + "까지" : "마감";
  const dayTable = ds.slice().reverse().map(d => { const r = dayInc(d); return `<tr><td>${mdK(d)}<span class="muted"> · ${dayState(d)}</span></td>${cols.map(k => `<td class="num">${fmt(r[k])}</td>`).join("")}<td class="num">${fmt(sum(r))}</td></tr>`; }).join("");
  const dateOpts = sel => ds.slice().reverse().map(d => `<option value="${d}"${d === sel ? " selected" : ""}>${mdK(d)}</option>`).join("");
  const candOpts = sel => order.map(k => `<option value="${k}"${k === sel ? " selected" : ""}>${nameOf(k)}</option>`).join("");

  /* 표차 */
  const gNow = vals[S.a] - vals[S.b];
  const gStat = m => { const r = back(m * MIN); if (!r || r[S.a] == null || r[S.b] == null) return "—"; const x = gNow - (r[S.a] - r[S.b]); return `<span class="${x > 0 ? "up" : x < 0 ? "down" : ""}">${signed(x)}</span>`; };
  const listOpen = openState[key + "-list"] ? " open" : "";

  v.innerHTML = `
  <div class="duel">${card(top, 1)}
    <div class="card gap"><span class="k">1·2위 표차</span><span class="v num" style="font-family:var(--f-disp)">${fmt(gap)}</span><span class="s">1시간 전보다 <span class="${gapH > 0 ? "up" : gapH < 0 ? "down" : ""}">${signed(gapH)}</span>${gapH > 0 ? " 벌어짐" : gapH < 0 ? " 좁혀짐" : ""}</span></div>
    ${card(sec, 2)}</div>
  <div class="panel">
    <div class="phead"><div><h2>${s.name} 전체 현황</h2><p>총 ${fmt(total)}표 · ${md(now)} ${hm(now)} 관측 · 점수는 이 사이트 1위 대비 ${RULES.siteMax}점 환산</p></div></div>
    <details id="${key}-list"${listOpen}><summary>${CANDS.length}팀 전체 보기</summary>
    <div class="tscroll"><table class="list"><thead><tr><th>순위</th><th>후보</th><th>득표수</th><th>점유율</th><th>앞 순위와</th><th>1시간 증가</th><th>점수</th></tr></thead><tbody>${listRows}</tbody></table></div></details>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>득표 추이</h2><p>${S.mode === "votes" ? "누적 득표수" : "전체 득표 대비 점유율"} · 1분 관측</p></div>
      <div class="ctrl">
        <span class="seg">${[["votes", "득표수"], ["share", "득표율"]].map(([k, l]) => `<button type="button" data-s="${key}" data-f="mode" data-v="${k}" aria-pressed="${S.mode === k}">${l}</button>`).join("")}</span>
        <span class="seg">${[["6h", "6시간"], ["24h", "24시간"], ["all", "전체"]].map(([k, l]) => `<button type="button" data-s="${key}" data-f="range" data-v="${k}" aria-pressed="${S.range === k}">${l}</button>`).join("")}</span>
      </div></div>
    <div class="chips">${chipsHTML(order, S.sel, key)}</div>
    <div class="chart" id="${key}-line"></div>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>표차 분석</h2><p>앞 후보 득표 − 뒤 후보 득표. 빨강은 격차 확대, 파랑은 격차 축소</p></div>
      <div class="ctrl">
        <select id="${key}-a" aria-label="앞 후보">${candOpts(S.a)}</select><span class="lbl">−</span><select id="${key}-b" aria-label="뒤 후보">${candOpts(S.b)}</select>
        <span class="seg">${[["5m", "5분"], ["30m", "30분"], ["1h", "1시간"], ["1d", "일"]].map(([k, l]) => `<button type="button" data-s="${key}" data-f="iv" data-v="${k}" aria-pressed="${S.iv === k}">${l}봉</button>`).join("")}</span>
      </div></div>
    <div class="stats"><div><div class="k">현재 표차</div><div class="v">${signed(gNow)}</div></div><div><div class="k">1시간 변화</div><div class="v">${gStat(60)}</div></div><div><div class="k">4시간 변화</div><div class="v">${gStat(240)}</div></div><div><div class="k">24시간 변화</div><div class="v">${gStat(1440)}</div></div></div>
    <div class="chart" id="${key}-candle"></div>
  </div>
  <div class="two">
    <div class="panel">
      <div class="phead"><div><h2>시간대별 증가량</h2><p>상위 6팀과 관심 후보 · KST</p></div><div class="ctrl"><select id="${key}-hd" aria-label="날짜">${dateOpts(S.hDate)}</select></div></div>
      <div class="tscroll"><table class="heat"><thead><tr><th>시간</th>${cols.map(k => `<th>${nameOf(k)}</th>`).join("")}</tr></thead><tbody>${heatRows || '<tr><td colspan="9">관측 없음</td></tr>'}</tbody></table></div>
    </div>
    <div class="panel">
      <div class="phead"><div><h2>일일 득표량</h2><p>${dayState(S.dDate)} · 00시 기준</p></div><div class="ctrl"><select id="${key}-dd" aria-label="날짜">${dateOpts(S.dDate)}</select></div></div>
      <div class="bars">${dShow.map(k => `<div class="bar${k === G.pin ? " pin" : ""}"><span class="nm">${nameOf(k)}</span><span class="t"><i style="width:${dd[k] / dMax * 100}%"></i></span><span class="num" style="text-align:right">${fmt(dd[k])}</span></div>`).join("")}</div>
    </div>
  </div>
  <div class="panel">
    <div class="phead"><div><h2>날짜별 마감 기록</h2><p>각 날짜 00시부터 다음 날 00시까지의 증가량</p></div></div>
    <div class="tscroll"><table class="heat"><thead><tr><th>날짜</th>${cols.map(k => `<th>${nameOf(k)}</th>`).join("")}<th>전체</th></tr></thead><tbody>${dayTable}</tbody></table></div>
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

/* ───────── 상태줄 · 렌더 · 이벤트 ───────── */
function renderStatus() {
  const el = $("#status");
  if (!P) { el.textContent = loadError ? "데이터를 불러오지 못했습니다" : "불러오는 중…"; return; }
  const now = Date.now(), m = P.sites.melon, b = P.sites.berriz;
  const site = s => s.latest
    ? `<b class="num">${hms(s.latest.observedAt)}</b>${s.stale ? ` <span class="warn">${Math.floor((now - s.latest.observedAt) / MIN)}분 전 값</span>` : ""}`
    : '<b class="warn">관측 없음</b>';
  const ok = !loadError && !m.stale && !b.stale;
  el.innerHTML = `<span class="live${ok ? "" : " off"}"><i></i><b>1분 간격 수집</b></span>
    <span>멜론 ${site(m)}</span><span>베리즈 ${site(b)}</span>
    ${P.live ? `<span>사이트 간 시각차 <b class="num">${Math.round(P.live.skewMs / 1000)}초</b></span>` : ""}
    <span>다음 갱신 <b class="num">${Math.max(0, Math.ceil((nextFetch - now) / 1000))}초</b></span>
    ${loadError ? '<span class="warn">최근 갱신 실패 · 이전 값 표시 중</span>' : ""}
    ${P.sample ? '<span class="sample">예시 데이터 · 투표 주소 공개 전 화면</span>' : ""}`;
}
function render() { if (P) { if (VIEW === "global") renderGlobal(); else renderSite(VIEW); } }
function show(view) {
  VIEW = VIEWS.includes(view) ? view : "global";
  for (const k of VIEWS) { $("#view-" + k).hidden = k !== VIEW; $("#tab-" + k).setAttribute("aria-selected", k === VIEW); }
  try { if (location.hash !== "#" + VIEW) history.replaceState(null, "", location.search + "#" + VIEW); } catch (e) {}
  render();
}
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) show(b.dataset.view); });
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

document.querySelector("main").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
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

// 자동 갱신: 보이는 탭에서만. 백그라운드로 가면 멈추고 돌아오면 바로 갱신.
setInterval(() => { renderStatus(); if (!document.hidden && Date.now() >= nextFetch) refresh(); }, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() >= nextFetch) refresh(); });

let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(render, 150); }).observe(document.querySelector("main"));

/* 테마 */
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
function syncThemeBtn() { $("#themeBtn").textContent = isDark() ? "일반" : "다크"; }
$("#themeBtn").addEventListener("click", () => { const t = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("mma-theme", t); } catch (e) {} syncThemeBtn(); });
syncThemeBtn();

/* 요약 복사 */
function summary() {
  if (VIEW === "global") {
    const L = P.live;
    if (!L || L.held) return "MMA 2026 글로벌 TOP10: 지금은 합산을 보류 중입니다.";
    const CUT = RULES.cutoff;
    return [`MMA 2026 글로벌 TOP10 잠정 순위 (${md(L.melonAt)} ${hm(L.melonAt)}, 심사 ${RULES.judgeScore}점 미반영)`,
      ...L.rows.slice(0, CUT).map(r => `${r.rank}. ${r.name} ${f2(r.total)} (음원 ${f2(r.chart)} + 멜론 ${f2(r.ms)} + 베리즈 ${f2(r.bs)})`),
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

show(location.hash.slice(1) || "global");
refresh();
