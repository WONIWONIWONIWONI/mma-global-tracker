// 관측 기록 다루기. 관측 1회 = {source, observedAt, sourceAt|null, totalVotes, candidates:{id: votes}}
import { COLLECT } from "./config.js";
import { MIN, HOUR } from "./time.js";

// 관측이 속한 수집 분(가장 가까운 정각 분). Cron이 몇 초 일찍·늦게 돌아도 같은 분으로 본다.
// 예: 00:00 수집이 23:59:59에 관측돼도 00시 마감값으로 쓴다.
export const slotOf = o => Math.round(o.observedAt / MIN) * MIN;

export function voteVector(o, ids) {
  return ids.map(id => { const x = o.candidates[id]; return typeof x === "number" && isFinite(x) ? x : null; });
}

// 수집 분이 t 이하인 마지막 관측의 위치(없으면 -1). obs는 시각순 정렬.
export function lastAtOrBefore(obs, t) {
  let lo = 0, hi = obs.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (slotOf(obs[m]) <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

// t 시점의 득표수. 너무 오래된 관측밖에 없으면 null.
export function votesAsOf(obs, t, ids) {
  const i = lastAtOrBefore(obs, t);
  if (i < 0 || t - slotOf(obs[i]) > COLLECT.gapMs) return null;
  return voteVector(obs[i], ids);
}

// 화면용 시계열. 최근 6시간은 1분, 48시간까지는 5분, 그 이전은 15분 간격으로 줄인다.
// 간격 시각은 정시 기준으로 맞추므로 매시 정각과 KST 00시가 항상 들어간다. 마지막 점은 최신 관측(실제 관측 시각).
// 반환: { t: [시각...], v: [[후보별 득표수|null]...] }
export function buildSeries(obs, ids, now) {
  const t = [], v = [];
  if (!obs.length) return { t, v };
  const stepAt = ts => ts >= now - 6 * HOUR ? MIN : ts >= now - 48 * HOUR ? 5 * MIN : 15 * MIN;
  const empty = ids.map(() => null), first = obs[0], latest = obs[obs.length - 1], end = slotOf(latest);
  t.push(first.observedAt); v.push(voteVector(first, ids));
  let p = 0;
  for (let g = Math.floor(first.observedAt / MIN) * MIN + MIN; g < end; g += MIN) {
    if (g % stepAt(g) !== 0) continue;
    while (p + 1 < obs.length && slotOf(obs[p + 1]) <= g) p++;
    t.push(g); v.push(g - slotOf(obs[p]) > COLLECT.gapMs ? empty : voteVector(obs[p], ids));
  }
  if (latest.observedAt > t[t.length - 1]) { t.push(latest.observedAt); v.push(voteVector(latest, ids)); }
  return { t, v };
}
