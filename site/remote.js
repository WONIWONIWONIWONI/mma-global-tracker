// 실제 API에서 관측을 받아 모아 두고, 점수 계산(core/api.js)을 브라우저에서 한 번 돌린다.
// Worker는 무료 플랜 CPU 한도(요청당 10ms) 때문에 계산하지 않고 미리 쌓아 둔 관측 조각만 내려준다.
//   /api/init             처음 한 번(또는 오래 자리를 비웠다 돌아왔을 때): 오늘 5분 간격 + 최근 7시간 1분 간격 + 지난 날짜 목록
//   /history/날짜.json    지난 날짜 하나의 5분 간격(보통 정적 파일이라 무료·무제한, 브라우저가 하루 동안 기억)
//   /api/latest           이후 갱신마다: 최근 2시간의 1분 간격
// 응답의 refreshSec 은 서버가 남은 요청 한도를 보고 정한 갱신 간격이다.
import { API_BASE } from "./settings.js";
import { buildPayload } from "./core/api.js";
import { MIN } from "./core/time.js";

const store = { melon: new Map(), berriz: new Map() };
const loadedDays = new Set();
let allDays = [];
let loaded = false, sample = false, lastOk = 0;
export let serverRefreshSec = 60;

function add(lines) {
  for (const o of lines) { const m = store[o.source]; if (m) m.set(o.observedAt, o); }
}
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " 응답 " + r.status);
  return r.json();
}
async function api(path) {
  const j = await getJSON(API_BASE + path);
  sample = !!j.sample;
  if (typeof j.refreshSec === "number" && j.refreshSec >= 60) serverRefreshSec = j.refreshSec;
  add(j.lines);
  return j;
}

// 지난 날짜들을 4개씩 나눠 받는다. 한 날짜가 실패해도 나머지는 보여 주고, 다음 갱신 때 다시 시도한다.
async function loadDays(days) {
  const todo = days.filter(d => !loadedDays.has(d));
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async d => {
      try { add((await getJSON(`/history/${d}.json`)).lines); loadedDays.add(d); }
      catch (e) { console.warn("지난 날짜를 못 받음", d, e.message); }
    }));
  }
}

export async function loadRemote() {
  // 오래 자리를 비웠다 돌아왔을 때만 처음처럼 받는다(기준은 데이터 시각이 아니라 마지막으로 받은 시각:
  // 수집이 멈춘 동안 모든 화면이 매분 전체를 다시 받는 일이 없게)
  if (!loaded || Date.now() - lastOk > 100 * MIN) {
    const j = await api("/init");
    allDays = j.days || [];
    await loadDays(allDays);
    loaded = true;
  } else {
    await api("/latest");
    if (loadedDays.size < allDays.length) await loadDays(allDays);   // 전에 실패한 날짜 다시 시도
  }
  lastOk = Date.now();
  const obs = {};
  for (const [k, m] of Object.entries(store)) obs[k] = [...m.values()].sort((a, b) => a.observedAt - b.observedAt);
  return buildPayload(obs, Date.now(), { sample });
}
