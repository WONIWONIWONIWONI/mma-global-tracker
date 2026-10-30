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
export function votesNeeded(gap, votes, max, score) {
  if (votes == null) return { type: "missing" };
  if (max <= 0) return { type: "unknown" };
  if (votes === max) return { type: "top" };                         // 이미 사이트 1위라 점수가 더 오르지 않음
  if (RULES.siteMax - score <= gap) return { type: "impossible" };   // 만점을 받아도 못 넘음
  return { type: "votes", n: Math.floor(gap * max / RULES.siteMax) + 1 };
}

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
  }).sort((x, y) => (x.total == null) - (y.total == null) || (y.total ?? 0) - (x.total ?? 0) || (y.chart ?? 0) - (x.chart ?? 0) || (y.ms + y.bs) - (x.ms + x.bs));
  rows.forEach((r, i) => {
    const ahead = rows[i - 1], ranked = r.total != null;
    r.rank = ranked ? i + 1 : null;
    r.gapAhead = ranked && ahead ? ahead.total - r.total : null;
    r.needMelon = r.gapAhead != null ? votesNeeded(r.gapAhead, r.mv, m.max, r.ms) : null;
    r.needBerriz = r.gapAhead != null ? votesNeeded(r.gapAhead, r.bv, b.max, r.bs) : null;
  });
  return { rows, melonMax: m.max, berrizMax: b.max };
}
