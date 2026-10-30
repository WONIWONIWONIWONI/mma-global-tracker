// API 응답 만들기. 점수 계산은 여기서 한 번만 하고 화면은 결과를 그리기만 한다.
// 입력: 사이트별 관측 배열(시각순). Worker는 D1에서 읽은 관측을, 가짜 모드는 생성한 관측을 넣는다.
import { CANDIDATES, SITES, RULES, COLLECT, PIN_DEFAULT, VOTE } from "./config.js";
import { standings, siteScores, combinedStandings } from "./scoring.js";
import { voteVector, votesAsOf, buildSeries } from "./history.js";
import { MIN, DAY, kstMidnight } from "./time.js";

const IDS = CANDIDATES.map(c => c.id);
const round3 = x => Math.round(x * 1000) / 1000;
const rankMap = st => Object.fromEntries(st.rows.map(r => [r.id, r.rank]));

function votesAt(M, B, t) {
  const m = votesAsOf(M, t, IDS, COLLECT.gapMs.melon), b = votesAsOf(B, t, IDS, COLLECT.gapMs.berriz);
  return m && b ? [m, b] : null;
}
function standingsAt(M, B, t) { const v = votesAt(M, B, t); return v ? standings(...v) : null; }

export function buildPayload(obsBySite, now, { sample = false } = {}) {
  const M = obsBySite.melon || [], B = obsBySite.berriz || [];
  const sites = {};
  for (const [key, obs] of [["melon", M], ["berriz", B]]) {
    const o = obs[obs.length - 1];
    const votes = o ? voteVector(o, IDS) : null, sc = votes ? siteScores(votes) : null;
    sites[key] = {
      name: SITES[key],
      latest: o ? { observedAt: o.observedAt, sourceAt: o.sourceAt ?? null, totalVotes: o.totalVotes ?? null, votes } : null,
      // 최신 관측에 값이 없는 후보(사이트가 이름·ID를 바꾸면 생김). 0점처럼 보이므로 화면에 경고한다.
      missing: votes ? CANDIDATES.filter((c, k) => votes[k] == null).map(c => c.name) : [],
      ageMs: o ? now - o.observedAt : null,
      stale: o ? now - o.observedAt > COLLECT.staleMs[key] : true,
      max: sc ? sc.max : null,
      scores: sc ? sc.scores : null,
      series: buildSeries(obs, IDS, now, COLLECT.gapMs[key])
    };
  }
  const starts = [M[0], B[0]].filter(Boolean).map(o => o.observedAt);
  const start = starts.length ? Math.min(...starts) : null;

  // 실시간 순위
  let live = null;
  const mL = sites.melon.latest, bL = sites.berriz.latest;
  if (mL && bL) {
    const skewMs = Math.abs(mL.observedAt - bL.observedAt), held = skewMs > COLLECT.maxSkewMs;
    live = { melonAt: mL.observedAt, berrizAt: bL.observedAt, skewMs, held, compare: null };
    if (!held) {
      Object.assign(live, standings(mL.votes, bL.votes));
      const m0 = kstMidnight(now);
      const p = m0 > start ? standingsAt(M, B, m0) : null;
      if (p) live.compare = { at: m0, ranks: rankMap(p) };
    }
  }

  // 매일 KST 00시 마감 순위
  const snapshots = [];
  if (start != null) {
    for (let d = kstMidnight(start) + DAY; d <= now; d += DAY) {
      const st = standingsAt(M, B, d);
      if (!st) continue;
      const prev = d - DAY > start ? standingsAt(M, B, d - DAY) : null;
      snapshots.push({ at: d, ...st, prevRanks: prev ? rankMap(prev) : null });
    }
  }

  // 점수 추이(10분 간격). trend 는 방식 1, trend2 는 방식 2(득표율 기준, 참고용)로 같은 시각들을 계산한다.
  const newTrend = () => ({ t: [], totals: CANDIDATES.map(() => []), g12: [], gcut: [] });
  const trend = newTrend(), trend2 = newTrend();
  const push = (tr, t, st) => {
    tr.t.push(t);
    for (const r of st.rows) tr.totals[IDS.indexOf(r.id)].push(r.total == null ? null : round3(r.total));
    const gap = (a, b) => a && b && a.total != null && b.total != null ? round3(a.total - b.total) : null;
    tr.g12.push(gap(st.rows[0], st.rows[1]));
    tr.gcut.push(gap(st.rows[RULES.cutoff - 1], st.rows[RULES.cutoff]));
  };
  const addTrend = (t, m, b) => { push(trend, t, standings(m, b)); push(trend2, t, combinedStandings(m, b, { need: false })); };
  if (live) {   // 합산 보류 중에도 두 사이트가 모두 있던 지난 구간은 보여 준다
    const STEP = 10 * MIN, end = Math.min(live.melonAt, live.berrizAt);
    for (let t = Math.ceil(start / STEP) * STEP; t <= end; t += STEP) { const v = votesAt(M, B, t); if (v) addTrend(t, ...v); }
    if (!live.held) addTrend(Math.max(live.melonAt, live.berrizAt), mL.votes, bL.votes);
  }

  return {
    generatedAt: now, sample, start,
    config: { candidates: CANDIDATES.map(({ id, name, chart }) => ({ id, name, chart })), rules: RULES, collect: COLLECT, pinDefault: PIN_DEFAULT, vote: VOTE },
    sites, live, snapshots, trend, trend2
  };
}
