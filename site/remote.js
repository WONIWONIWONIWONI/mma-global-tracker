// 실제 API(/api)에서 관측을 받아 모아 두고, 점수 계산(core/api.js)을 브라우저에서 한 번 돌린다.
// Worker는 무료 플랜 CPU 한도(요청당 10ms) 때문에 계산하지 않고 미리 쌓아 둔 관측 조각만 내려준다.
//   /api/history?before=날짜  지난 날짜들의 5분 간격 관측(처음 한 번)
//   /api/live                 오늘의 5분 간격 + 최근 8시간의 1분 간격 관측(처음, 또는 오래 쉬었다 돌아왔을 때)
//   /api/latest               최근 2시간의 1분 간격 관측(1분마다)
import { API_BASE } from "./settings.js";
import { buildPayload } from "./core/api.js";
import { MIN, KST_OFFSET } from "./core/time.js";

const store = { melon: new Map(), berriz: new Map() };
let loaded = false, sample = false, lastSeen = 0;
const kstDate = ts => new Date(ts + KST_OFFSET).toISOString().slice(0, 10);

async function get(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error("API 응답 " + r.status);
  const j = await r.json();
  sample = !!j.sample;
  for (const o of j.lines) {
    const m = store[o.source];
    if (!m) continue;
    m.set(o.observedAt, o);
    if (o.observedAt > lastSeen) lastSeen = o.observedAt;
  }
}

export async function loadRemote() {
  const now = Date.now();
  if (!loaded) { await Promise.all([get("/history?before=" + kstDate(now)), get("/live")]); loaded = true; }
  else if (now - lastSeen > 100 * MIN) await get("/live");
  else await get("/latest");
  const obs = {};
  for (const [k, m] of Object.entries(store)) obs[k] = [...m.values()].sort((a, b) => a.observedAt - b.observedAt);
  return buildPayload(obs, Date.now(), { sample });
}
