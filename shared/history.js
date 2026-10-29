// 관측 기록 다루기. 관측 1회 = {source, observedAt, sourceAt|null, totalVotes, candidates:{id: votes}}
import { COLLECT } from "./config.js";
import { MIN, HOUR } from "./time.js";

export function voteVector(o, ids) {
  return ids.map(id => { const x = o.candidates[id]; return typeof x === "number" && isFinite(x) ? x : null; });
}

// observedAt <= t 인 마지막 관측의 위치(없으면 -1). obs는 시각순 정렬.
export function lastAtOrBefore(obs, t) {
  let lo = 0, hi = obs.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (obs[m].observedAt <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

// t 시점에 알고 있던 득표수. 너무 오래된 관측밖에 없으면 null.
export function votesAsOf(obs, t, ids) {
  const i = lastAtOrBefore(obs, t);
  if (i < 0 || t - obs[i].observedAt > COLLECT.gapMs) return null;
  return voteVector(obs[i], ids);
}

// 화면용 시계열. 최근 6시간은 1분, 48시간까지는 5분, 그 이전은 15분 간격으로 줄인다.
// 간격 시각은 정시 기준으로 맞추므로 매시 정각과 KST 00시가 항상 들어간다.
// 반환: { t: [시각...], v: [[후보별 득표수|null]...] }
export function buildSeries(obs, ids, now) {
  const t = [], v = [];
  if (!obs.length) return { t, v };
  const stepAt = ts => ts >= now - 6 * HOUR ? MIN : ts >= now - 48 * HOUR ? 5 * MIN : 15 * MIN;
  const empty = ids.map(() => null), first = obs[0], latest = obs[obs.length - 1];
  t.push(first.observedAt); v.push(voteVector(first, ids));
  let p = 0;
  for (let g = Math.floor(first.observedAt / MIN) * MIN + MIN; g <= latest.observedAt; g += MIN) {
    if (g % stepAt(g) !== 0) continue;
    while (p + 1 < obs.length && obs[p + 1].observedAt <= g) p++;
    t.push(g); v.push(g - obs[p].observedAt > COLLECT.gapMs ? empty : voteVector(obs[p], ids));
  }
  if (latest.observedAt > t[t.length - 1]) { t.push(latest.observedAt); v.push(voteVector(latest, ids)); }
  return { t, v };
}
