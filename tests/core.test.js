// 핵심 계산 자동 시험. 실행: npm test (node --test). 배포(npm run deploy)와 GitHub push 때 먼저 돈다.
// 외부 라이브러리 없이 Node 기본 시험 도구만 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import { CANDIDATES, RULES, COLLECT } from "../site/core/config.js";
import { siteScores, votesNeeded, standings, combinedStandings } from "../site/core/scoring.js";
import { slotOf, votesAsOf } from "../site/core/history.js";
import { buildPayload } from "../site/core/api.js";
import { fgap, gapLabel } from "../site/format.js";
import { readFileSync } from "node:fs";

const MIN = 60e3;
const T = Date.parse("2026-10-31T00:00:00+09:00");   // KST 자정
const N = CANDIDATES.length;
const vec = f => CANDIDATES.map((c, k) => f(k, c));

test("사이트 점수: 1위 대비 10점, 값 없음은 0점, 모두 0표면 0점", () => {
  const { max, scores } = siteScores([100, 50, null, 0]);
  assert.equal(max, 100);
  assert.deepEqual(scores, [10, 5, 0, 0]);
  assert.deepEqual(siteScores([0, 0]).scores, [0, 0]);
});

test("역전에 필요한 표: 다른 후보가 그대로일 때", () => {
  // 1위 1000표, 내 점수 5점(500표), 앞 순위와 1점 차 → 100표 넘게(101표) 더 받아야 함
  assert.deepEqual(votesNeeded(1, 500, 1000, 5), { type: "votes", n: 101 });
  assert.equal(votesNeeded(6, 500, 1000, 5).type, "impossible");
  assert.equal(votesNeeded(1, 1000, 1000, 10).type, "top");
  assert.equal(votesNeeded(1, null, 1000, 0).type, "missing");
});

test("투표 점수만 합산(useChart=false): 30팀 모두 순위, 합산 = 멜론 + 베리즈", () => {
  const was = RULES.useChart;
  RULES.useChart = false;
  try {
    const st = standings(vec(k => (N - k) * 10), vec(k => (k + 1) * 10));
    assert.equal(RULES.provisionalMax, 20);
    assert.equal(st.rows.length, N);
    st.rows.forEach((r, i) => {
      assert.equal(r.rank, i + 1);
      assert.equal(r.chart, null);
      assert.ok(Math.abs(r.total - (r.ms + r.bs)) < 1e-9);
      if (i) assert.ok(st.rows[i - 1].total >= r.total);
    });
  } finally { RULES.useChart = was; }
});

test("방식 2(득표율 기준): @kowartermelon 10/30 예측표와 같은 순위·점수", () => {
  // 그 표의 멜론·베리즈 표. 베리즈 × (멜론 합 ÷ 베리즈 합) + 멜론 → 1위를 20점으로 환산
  const T = { bts: [11295, 18134], aespa: [3163, 837], cortis: [4296, 8492], ive: [3618, 973], bigbang: [1095, 960], gdragon: [22012, 394],
    nctwish: [14238, 1383], rescene: [38834, 348], seventeen: [2318, 554], riize: [13286, 1731], illit: [936, 343], txt: [1622, 255],
    hearts2hearts: [3334, 3372], boynextdoor: [2930, 437], twice: [168, 47], lesserafim: [240, 31], idle: [203, 213], straykids: [366, 56],
    iu: [2066, 1437], blackpink: [161, 50], enhypen: [758, 314], exo: [1521, 516], nmixx: [791, 6], newjeans: [841, 159],
    nctdream: [5660, 4072], babymonster: [169, 73], tws: [5093, 293], jennie: [234, 16], rose: [157, 6], yena: [329, 50] };
  const want = ["bts", "aespa", "cortis", "ive", "bigbang", "gdragon", "nctwish", "rescene", "seventeen", "riize", "illit", "txt"];
  const was = RULES.useChart;
  RULES.useChart = true;
  try {
    const m = vec((k, c) => T[c.id][0]), b = vec((k, c) => T[c.id][1]);
    const st = combinedStandings(m, b), by = id => st.rows.find(r => r.id === id);
    assert.deepEqual(st.rows.slice(0, want.length).map(r => r.id), want);
    assert.ok(Math.abs(st.ratio - 141734 / 45552) < 1e-9);
    for (const [id, v] of [["bts", 20], ["rescene", 11.79], ["cortis", 9.07], ["gdragon", 6.87]]) assert.ok(Math.abs(by(id).vote - v) < 0.015, id);
    // 역전 필요 표: 그만큼 더하면 앞 후보를 넘고, 1표 적으면 못 넘는다(배수가 바뀌는 것까지 다시 계산)
    const r = by("rescene"), n = r.needMelon.n, ahead = st.rows[r.rank - 2];
    const after = d => { const x = m.slice(), k = CANDIDATES.findIndex(c => c.id === "rescene"); x[k] += d; const s2 = combinedStandings(x, b).rows; return s2.find(q => q.id === "rescene").total > s2.find(q => q.id === ahead.id).total; };
    assert.ok(after(n) && !after(n - 1));
  } finally { RULES.useChart = was; }
});

test("음원 포함(useChart=true): 음원 점수 없는 팀은 순위 없이 맨 아래", () => {
  const was = RULES.useChart, first = CANDIDATES[0], chart = first.chart;
  RULES.useChart = true;
  first.chart = null;   // 시험 동안만 1위 팀 음원 점수를 비운다(지금은 30팀 모두 점수가 있음)
  try {
    const st = standings(vec(() => 100), vec(() => 100));
    assert.equal(RULES.provisionalMax, 80);
    const ranked = st.rows.filter(r => r.rank != null), unranked = st.rows.filter(r => r.rank == null);
    assert.equal(ranked.length, CANDIDATES.length - 1);
    assert.equal(unranked.length, 1);
    assert.ok(unranked.every(r => r.total == null));
    assert.ok(st.rows.indexOf(unranked[0]) > st.rows.indexOf(ranked[ranked.length - 1]));
  } finally { RULES.useChart = was; first.chart = chart; }
});

test("시각 기준(slotOf): 자정 몇 초 전 관측은 자정 값, 20초 수집은 그 분, 베리즈는 집계 시각", () => {
  assert.equal(slotOf({ observedAt: T - 2000 }), T);                 // 23:59:58 → 00:00
  assert.equal(slotOf({ observedAt: T + 40e3 }), T);                 // 00:00:40 → 00:00
  assert.equal(slotOf({ observedAt: T - 20e3 }), T - MIN);           // 23:59:40 → 23:59
  assert.equal(slotOf({ observedAt: T + 3 * MIN, sourceAt: T }), T); // 베리즈 00:00 집계를 00:03에 받음 → 00:00
});

test("빈 구간: 사이트별 허용 시간을 넘으면 값 없음(0으로 채우지 않음)", () => {
  const ids = CANDIDATES.map(c => c.id), o = { observedAt: T, sourceAt: T, candidates: { bts: 5 } };
  assert.equal(votesAsOf([o], T + 20 * MIN, ids, COLLECT.gapMs.berriz)[0], 5);
  assert.equal(votesAsOf([o], T + 30 * MIN, ids, COLLECT.gapMs.berriz), null);
  assert.equal(votesAsOf([o], T + 11 * MIN, ids, COLLECT.gapMs.melon), null);
});

test("합산: 멜론 20초 + 베리즈 10분 간격이어도 보류하지 않고, 빠진 팀을 알려 줌", () => {
  const all = Object.fromEntries(CANDIDATES.map((c, k) => [c.id, 100 + k]));
  const { bts, ...noBts } = all;
  const M = [0, 20, 40, 60].map(s => ({ source: "melon", observedAt: T + s * 1000, sourceAt: null, candidates: all }));
  const B = [{ source: "berriz", observedAt: T - 9 * MIN, sourceAt: T - 10 * MIN, candidates: noBts }];
  const p = buildPayload({ melon: M, berriz: B }, T + 61e3);
  assert.ok(p.live && !p.live.held);
  assert.deepEqual(p.sites.melon.missing, []);
  assert.deepEqual(p.sites.berriz.missing, ["BTS"]);
  // 점수 추이는 방식 1(trend)과 방식 2(trend2)를 같은 시각들로 만든다
  assert.ok(p.trend.t.length > 0);
  assert.deepEqual(p.trend2.t, p.trend.t);
  assert.equal(p.trend2.totals.length, CANDIDATES.length);
});

test("최종 결과: 저장된 날짜별 기록으로 계산, 멜론 마감값과 베리즈 마지막 집계(21:40)를 보류 없이 합산", async () => {
  // 브라우저 fetch 대신 site/ 폴더의 파일을 읽는다
  globalThis.fetch = async u => {
    try { const t = readFileSync(new URL("../site" + u, import.meta.url), "utf8"); return { ok: true, json: async () => JSON.parse(t) }; }
    catch (e) { return { ok: false, status: 404 }; }
  };
  const remote = await import("../site/remote.js");
  assert.equal(remote.DAYS.length, 15);
  assert.deepEqual([remote.DAYS[0], remote.DAYS[14]], ["2026-10-30", "2026-11-13"]);
  const first = await remote.loadRemote();
  assert.ok(first.live && !first.live.held && first.live.rows.length === N);
  const p = await remote.takeLateBuild();
  assert.equal(p.sites.melon.latest.totalVotes, 3664867);          // 마감 직후 20초 뒤 굳은 값
  assert.equal(p.sites.berriz.latest.sourceAt, Date.parse("2026-11-13T21:40:00+09:00"));
  assert.ok(!p.live.held && !p.sites.berriz.stale);
  assert.ok(p.live.compare && p.live.compare.ranks && p.live.compare.ranks2);  // 마지막 날 00시 대비
  // 00시 마감 기록: 10/31 ~ 11/13 중 11/11·11/12 는 자정 전후 베리즈 수집이 비어 없다(값을 지어내지 않음)
  const day = t => new Date(t + 9 * 3600e3).toISOString().slice(5, 10);
  assert.equal(p.snapshots.map(s => day(s.at)).join(" "), "10-31 11-01 11-02 11-03 11-04 11-05 11-06 11-07 11-08 11-09 11-10 11-13");
  assert.ok(p.trend.t.length > 1000 && p.trend2.t.length === p.trend.t.length);
});

test("점수 차 표시: 근소한 차이는 소수 셋째 자리, 같으면 동점", () => {
  assert.equal(fgap(1.234), "1.23");
  assert.equal(fgap(0.0042), "0.004");
  assert.equal(fgap(0.0004), "<0.001");
  assert.equal(gapLabel(0), "동점");
  assert.equal(gapLabel(0.0042), "−0.004");
});
