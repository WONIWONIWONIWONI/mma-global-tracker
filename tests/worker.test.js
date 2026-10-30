// Worker 동작 자동 시험(가짜 D1로): GitHub 보조 수집이 이미 있는 분을 다시 저장하지 않는지, 베리즈 같은 집계를
// 두 번 저장하지 않는지, 비밀값이 틀리면 거절하는지, 갱신 간격이 몰릴 때 늘고 천천히 줄어드는지.
import test from "node:test";
import assert from "node:assert/strict";
import worker, { adjustRefresh } from "../worker/index.js";
import { CANDIDATES } from "../site/core/config.js";

const MIN = 60e3;

// SQL 문장을 받아 respond(sql, args)가 정한 결과를 돌려주는 가짜 D1. 실행된 문장을 log에 남긴다.
function fakeDB(respond = () => []) {
  const log = [];
  const prepare = sql => {
    const s = { sql, args: [], bind(...a) { s.args = a; return s; },
      async all() { return { results: respond(sql, s.args) }; },
      async first() { return respond(sql, s.args)[0] ?? null; },
      async run() { log.push(s); return {}; } };
    return s;
  };
  return { log, prepare, async batch(list) { log.push(...list); return list.map(s => ({ results: respond(s.sql, s.args) })); } };
}
const ctx = { waitUntil() {} };
const TOKEN = "test-token";
const post = (path, body, token = TOKEN, headers = {}) => new Request("https://x.test" + path, {
  method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const nominees = CANDIDATES.map((c, k) => ({ id: c.siteIds.melon, voteCount: 100 + k }));
const inserts = db => db.log.filter(s => s.sql.startsWith("INSERT OR IGNORE INTO obs"));

test("멜론 보조 수집: 이미 있는 분은 버리고 빠진 분만 저장", async () => {
  const now = Date.now(), t0 = Math.floor(now / MIN) * MIN - 5 * MIN;
  const db = fakeDB(sql => sql.includes("SELECT observed_at FROM obs") ? [{ observed_at: t0 + 1000 }] : []);
  const items = [t0 + 3000, t0 + MIN + 3000].map(observedAt => ({ observedAt, nominees }));
  const r = await worker.fetch(post("/api/ingest/melon", { items }), { DB: db, INGEST_TOKEN: TOKEN }, ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, stored: 1, skipped: 1 });
  assert.equal(inserts(db).length, 1);
  assert.equal(inserts(db)[0].args[1], t0 + MIN + 3000);
});

test("비밀값이 틀리면 거절", async () => {
  const db = fakeDB();
  const r = await worker.fetch(post("/api/ingest/melon", { items: [] }, "wrong"), { DB: db, INGEST_TOKEN: TOKEN }, ctx);
  assert.equal(r.status, 401);
  assert.equal(db.log.length, 0);
});

test("베리즈: 같은 집계는 한 번만, 새 집계는 GitHub이 읽은 시각으로 저장", async () => {
  const agg = Math.floor(Date.now() / (10 * MIN)) * 10 * MIN - 10 * MIN, read = agg + 70e3;
  const body = { code: "0000", data: { aggregatedAt: new Date(agg).toISOString(), totalVotes: 30,
    candidates: CANDIDATES.map(c => ({ name: c.siteIds.berriz, voteCount: 1 })) } };
  const same = fakeDB(sql => sql.includes("SELECT source_at") ? [{ source_at: agg }] : []);
  let r = await worker.fetch(post("/api/ingest/berriz", body), { DB: same, INGEST_TOKEN: TOKEN }, ctx);
  assert.equal((await r.json()).stored, false);
  assert.equal(inserts(same).length, 0);
  const older = fakeDB(sql => sql.includes("SELECT source_at") ? [{ source_at: agg - 10 * MIN }] : []);
  r = await worker.fetch(post("/api/ingest/berriz", body, TOKEN, { "x-observed-at": String(read) }), { DB: older, INGEST_TOKEN: TOKEN }, ctx);
  assert.equal((await r.json()).stored, true);
  assert.equal(inserts(older)[0].args[1], read);
});

// 갱신 간격 계산: c:<분> 표본 집계(rate)와 지난 간격(prev)으로 새 간격을 정해 m:refresh 에 쓴다
async function nextRefresh({ perMin, prev, used = 0 }) {
  const at = Date.parse("2026-11-01T03:00:00Z");   // UTC 하루 중 3시간 지남
  const m = Math.floor(at / MIN);
  const db = fakeDB((sql, args) => {
    if (sql.includes("k IN (?, ?, ?)")) return args.map(k => ({ k, body: String(perMin) }));
    if (args[0] === "m:usage") return [{ body: JSON.stringify({ used, checkedAt: at - MIN }) }];
    if (args[0] === "m:refresh") return prev ? [{ body: JSON.stringify({ refreshSec: prev, at: at - MIN }) }] : [];
    return [];
  });
  await adjustRefresh({ DB: db }, at);
  const put = db.log.find(s => s.sql.startsWith("INSERT") && s.args[0] === "m:refresh");
  return put ? JSON.parse(put.args[1]).refreshSec : prev;
}

test("갱신 간격: 한가하면 20초, 몰리면 바로 늘리고, 줄일 때는 1분에 절반까지만", async () => {
  assert.equal(await nextRefresh({ perMin: 8, prev: 20 }), 20);
  const busy = await nextRefresh({ perMin: 3000, prev: 20 });   // 1분에 3,000번 → 크게 늘어야 함
  assert.ok(busy >= 60, "몰릴 때 간격 " + busy);
  assert.equal(await nextRefresh({ perMin: 0, prev: 600 }), 300);   // 한가해져도 600 → 300초까지만
  assert.equal(await nextRefresh({ perMin: 100, prev: 20, used: 95000 }), 600);   // 한도를 거의 다 씀 → 최대
});
