// 점수 계산. 사이트 점수 = 10 × (후보 득표수 ÷ 그 사이트 1위 득표수), 1위 득표수가 0이면 0점.
// 반올림 규칙은 공지 확인 전이라 반올림하지 않는다(화면에서만 소수 둘째 자리로 보여 준다).
import { CANDIDATES, RULES } from "./config.js";

// votes: CANDIDATES 순서의 득표수 배열(관측 없는 후보는 null)
export function siteScores(votes) {
  let max = 0;
  for (const v of votes) if (v != null && v > max) max = v;
  return { max, scores: votes.map(v => v == null || max <= 0 ? 0 : RULES.siteMax * v / max) };
}

// 다른 후보 표가 그대로일 때, 이 사이트에서만 표를 더 받아 앞 순위를 넘으려면 몇 표가 필요한가
// full: 그 점수의 만점(사이트 점수는 10, 표 합산 비교용은 20)
export function votesNeeded(gap, votes, max, score, full = RULES.siteMax) {
  if (votes == null) return { type: "missing" };
  if (max <= 0) return { type: "unknown" };
  if (votes === max) return { type: "top" };                         // 이미 1위라 점수가 더 오르지 않음
  if (full - score <= gap) return { type: "impossible" };            // 만점을 받아도 못 넘음
  return { type: "votes", n: Math.floor(gap * max / full) + 1 };
}

// 정렬: 순위 없는 후보는 맨 아래, 합산 → 음원 → 투표 점수 순
const byTotal = vote => (x, y) => (x.total == null) - (y.total == null) || (y.total ?? 0) - (x.total ?? 0) || (y.chart ?? 0) - (x.chart ?? 0) || vote(y) - vote(x);

// RULES.useChart 가 true면 음원 + 멜론 + 베리즈. 음원 점수를 모르는 후보(chart: null)는 합산할 수 없으므로
// 순위(rank)를 매기지 않고 맨 아래에 투표 점수 순으로 둔다.
// false면 투표 점수(멜론 + 베리즈)만 합산하고 모든 후보에 순위를 매긴다(chart 는 null로 내보냄).
export function standings(melonVotes, berrizVotes) {
  const m = siteScores(melonVotes), b = siteScores(berrizVotes);
  const rows = CANDIDATES.map((c, k) => {
    const chart = RULES.useChart ? c.chart : null, vote = m.scores[k] + b.scores[k];
    return {
      id: c.id, name: c.name, chart,
      mv: melonVotes[k], bv: berrizVotes[k], ms: m.scores[k], bs: b.scores[k],
      total: !RULES.useChart ? vote : chart == null ? null : chart + vote
    };
  }).sort(byTotal(r => r.ms + r.bs));
  rows.forEach((r, i) => {
    const ahead = rows[i - 1], ranked = r.total != null;
    r.rank = ranked ? i + 1 : null;
    r.gapAhead = ranked && ahead ? ahead.total - r.total : null;
    r.needMelon = r.gapAhead != null ? votesNeeded(r.gapAhead, r.mv, m.max, r.ms) : null;
    r.needBerriz = r.gapAhead != null ? votesNeeded(r.gapAhead, r.bv, b.max, r.bs) : null;
  });
  return { rows, melonMax: m.max, berrizMax: b.max };
}

// 방식 2(득표율 기준, 사용자 요청 10/30, @kowartermelon 예측표와 같은 계산). 공지 "1:1 합산"의 또 다른 해석으로 방식 1과 같은 무게로 보여 준다.
// 두 사이트 전체 표가 1:1이 되도록 베리즈 표에 (멜론 30팀 표 합 ÷ 베리즈 30팀 표 합)을 곱해 멜론 표에 더한다
// (= 두 사이트 득표율을 더한 것과 같은 순서). 이 합계가 가장 큰 후보를 투표 만점(20점)으로 두고 비율대로 나눈다.
// 값이 없는 사이트는 0표로 계산하고 missing 표시.
const tally = a => a.reduce((s, v) => s + (v ?? 0), 0);
function weighted(mv, bv) {
  const M = tally(mv), B = tally(bv), ratio = B > 0 ? M / B : 0;
  const sums = CANDIDATES.map((c, k) => mv[k] == null && bv[k] == null ? null : (mv[k] ?? 0) + (bv[k] ?? 0) * ratio);
  let max = 0;
  for (const v of sums) if (v != null && v > max) max = v;
  const full = 2 * RULES.siteMax, vote = k => sums[k] == null || max <= 0 ? 0 : full * sums[k] / max;
  return { ratio, sums, max, vote };
}
const chartOf = k => RULES.useChart ? CANDIDATES[k].chart : null;
const totalOf = (k, w) => { const c = chartOf(k), v = w.vote(k); return !RULES.useChart ? v : c == null ? null : c + v; };

// need: false 면 역전 필요 표를 계산하지 않는다(점수 추이처럼 많은 시점을 계산할 때 빠르게)
export function combinedStandings(melonVotes, berrizVotes, { need = true } = {}) {
  const w = weighted(melonVotes, berrizVotes);
  const rows = CANDIDATES.map((c, k) => ({
    id: c.id, name: c.name, k0: k, chart: chartOf(k), mv: melonVotes[k], bv: berrizVotes[k], sum: w.sums[k],
    missing: melonVotes[k] == null || berrizVotes[k] == null, vote: w.vote(k), total: totalOf(k, w)
  })).sort(byTotal(r => r.vote));
  rows.forEach((r, i) => {
    const ahead = rows[i - 1];
    r.rank = r.total != null ? i + 1 : null;
    r.gapAhead = r.rank != null && ahead ? ahead.total - r.total : null;
    if (!need) return;
    r.needMelon = r.gapAhead != null ? weightedNeed(melonVotes, berrizVotes, r.k0, ahead.k0, "m") : null;
    r.needBerriz = r.gapAhead != null ? weightedNeed(melonVotes, berrizVotes, r.k0, ahead.k0, "b") : null;
  });
  return { rows, ratio: w.ratio, max: w.max };
}

// 방식 2에서 한 사이트에서만 표를 더 받아 앞 후보를 넘으려면 몇 표가 필요한가(다른 후보 표는 그대로).
// 표를 더하면 그 사이트 전체 표와 환산 배수도 바뀌므로 공식 대신 전체를 다시 계산해 가며 찾는다(2배씩 늘린 뒤 반으로 좁힘).
function weightedNeed(mv, bv, k, a, site) {
  const own = site === "m" ? mv : bv;
  if (own[k] == null) return { type: "missing" };
  const passes = n => {
    const x = own.slice(); x[k] += n;
    const w = site === "m" ? weighted(x, bv) : weighted(mv, x);
    return totalOf(k, w) > totalOf(a, w);
  };
  let hi = 1;
  while (!passes(hi)) { hi *= 2; if (hi > 1e10) return { type: "impossible" }; }
  let lo = hi / 2 | 0;   // lo 는 넘지 못하는 값(0 포함), hi 는 넘는 값
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (passes(mid)) hi = mid; else lo = mid; }
  return { type: "votes", n: hi };
}
