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

// 비교용(사용자 요청 10/30): 두 사이트 득표수를 그냥 더하고, 더한 표가 가장 많은 후보를 투표 만점(20점)으로 두어
// 비율대로 나눈다. 공지 방식(사이트마다 10점씩 1:1 합산)이 아니라 "이렇게 계산하면 어떻게 되나"를 보는 참고용.
// 한 사이트 값이 없으면 그 사이트를 0표로 더하고 missing 으로 표시한다. 역전 필요 표는 어느 사이트 표든 1표가 같다.
export function combinedStandings(melonVotes, berrizVotes) {
  const full = 2 * RULES.siteMax;
  const sums = CANDIDATES.map((c, k) => melonVotes[k] == null && berrizVotes[k] == null ? null : (melonVotes[k] ?? 0) + (berrizVotes[k] ?? 0));
  let max = 0;
  for (const v of sums) if (v != null && v > max) max = v;
  const rows = CANDIDATES.map((c, k) => {
    const chart = RULES.useChart ? c.chart : null, vote = sums[k] == null || max <= 0 ? 0 : full * sums[k] / max;
    return { id: c.id, name: c.name, chart, mv: melonVotes[k], bv: berrizVotes[k], sum: sums[k], missing: melonVotes[k] == null || berrizVotes[k] == null, vote,
      total: !RULES.useChart ? vote : chart == null ? null : chart + vote };
  }).sort(byTotal(r => r.vote));
  rows.forEach((r, i) => {
    const ahead = rows[i - 1];
    r.rank = r.total != null ? i + 1 : null;
    r.gapAhead = r.rank != null && ahead ? ahead.total - r.total : null;
    r.need = r.gapAhead != null ? combinedNeed(r, ahead, max, full) : null;
  });
  return { rows, max };
}

// 방식 2에서 앞 후보를 넘는 데 필요한 표(다른 후보 표는 그대로). 합산 1위를 넘어서면 그 후보가 새 기준(만점)이 되어
// 앞 후보 점수가 내려가므로, 방식 1과 달리 "만점을 받아도 못 넘음"이 거의 없다.
function combinedNeed(r, ahead, max, full) {
  if (r.sum == null) return { type: "missing" };
  if (max <= 0) return { type: "unknown" };
  const gap = ahead.total - r.total;
  if (full - r.vote > gap) return { type: "votes", n: Math.floor(gap * max / full) + 1 };   // 합산 1위를 넘기 전에 따라잡음
  // 합산 1위보다 많아져야 하는 경우: 내 투표는 만점, 앞 후보는 full × 앞 후보 표 ÷ 내 새 표
  const d = (r.chart ?? 0) - (ahead.chart ?? 0) + full;
  if (d <= 0) return { type: "impossible" };
  const target = Math.max(max, Math.floor(full * ahead.sum / d)) + 1;
  return { type: "votes", n: target - r.sum };
}
