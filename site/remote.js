// 투표가 끝나 수집을 멈췄다. 화면은 투표 기간의 날짜별 기록 파일(/history/날짜.json, 정적 파일)만 읽는다.
// 첫 화면은 마지막 날 파일만으로 최종 순위를 먼저 그리고, 나머지 날짜는 뒤에서 받아 추이·마감 기록을 채운다.
import { buildPayload } from "./core/api.js";
import { VOTE } from "./core/config.js";
import { DAY, KST_OFFSET, kstMidnight } from "./core/time.js";

// 최종 결과 기준 시각: 마감(11/14 00:00) 바로 전. "변동"은 마지막 날 00시(11/13 00:00)와 비교된다
export const FINAL_AT = Date.parse(VOTE.end) - 1;
const END = Date.parse(VOTE.end);
export const DAYS = [];
for (let d = kstMidnight(Date.parse(VOTE.start)); d < END; d += DAY) DAYS.push(new Date(d + KST_OFFSET).toISOString().slice(0, 10));

const store = { melon: new Map(), berriz: new Map() };
const loadedDays = new Set();

async function loadDay(d) {
  const r = await fetch(`/history/${d}.json`);
  if (!r.ok) throw new Error(`/history/${d}.json 응답 ${r.status}`);
  // 마감 뒤 관측은 쓰지 않는다(마감 분 00:00 값까지)
  for (const o of (await r.json()).lines) if (store[o.source] && o.observedAt < END + 60e3) store[o.source].set(o.observedAt, o);
  loadedDays.add(d);
}

function build() {
  const obs = {};
  for (const [k, m] of Object.entries(store)) obs[k] = [...m.values()].sort((a, b) => a.observedAt - b.observedAt);
  return buildPayload(obs, FINAL_AT, { final: true });
}

let lateBuild = null;
export function takeLateBuild() { const p = lateBuild; lateBuild = null; return p; }

export async function loadRemote() {
  await loadDay(DAYS[DAYS.length - 1]);
  const rest = DAYS.filter(d => !loadedDays.has(d));
  if (rest.length) lateBuild = Promise.all(rest.map(d => loadDay(d).catch(e => console.warn("지난 날짜를 못 받음", d, e.message)))).then(build);
  return build();
}
