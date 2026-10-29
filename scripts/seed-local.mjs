// 로컬 테스트용: 내 컴퓨터의 D1(--local)에 2.5일치 가짜 관측을 Worker와 같은 구조로 채운다.
// 실행: node scripts/seed-local.mjs  → .wrangler/seed.sql 생성 후 wrangler로 로컬 D1에 넣는다. 실제(원격) D1은 건드리지 않는다.
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fakeObservations } from "../site/core/fakeSource.js";
import { MIN, HOUR } from "../site/core/time.js";
import { hourKey, dayBlobKey } from "../worker/index.js";

const now = Date.now(), o = fakeObservations(now);
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const sql = ["DELETE FROM obs;", "DELETE FROM blob;"], blobs = new Map();
// D1 문장 길이 제한(100KB) 때문에 Worker처럼 조금씩 이어 붙인다.
const add = (k, line, at) => { const b = blobs.get(k) || []; b.push([line, at]); blobs.set(k, b); };

for (const source of ["melon", "berriz"]) {
  for (const x of o[source]) {
    const at = Math.round(x.observedAt / MIN) * MIN;   // 그 관측을 만든 수집 분
    sql.push(`INSERT INTO obs VALUES (${q(source)}, ${x.observedAt}, NULL, ${x.totalVotes}, ${q(JSON.stringify(x.candidates))});`);
    const line = JSON.stringify(x) + ",", dk = dayBlobKey(at);
    if (at >= now - 8 * HOUR) add(hourKey(at), line, at);
    if (dk) add(dk, line, at);
  }
}
for (const [k, b] of blobs) {
  for (let i = 0; i < b.length; i += 40) {
    const part = b.slice(i, i + 40), at = Math.max(...part.map(p => p[1]));
    sql.push(`INSERT INTO blob (k, body, updated_at) VALUES (${q(k)}, ${q(part.map(p => p[0]).join(""))}, ${at}) ON CONFLICT(k) DO UPDATE SET body = body || excluded.body, updated_at = excluded.updated_at;`);
  }
}
writeFileSync(".wrangler/seed.sql", sql.join("\n"));
console.log(`관측 ${o.melon.length + o.berriz.length}개, 조각 ${blobs.size}개`);
execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "mma-tracker", "--local", "--file", ".wrangler/seed.sql"], { stdio: "inherit" });
