// Cloudflare Worker: 1분마다 멜론·베리즈를 수집해 D1에 쌓고, /api 요청에 관측 조각을 내려준다.
// 화면 파일(site/)은 정적 자산으로 따로 나가므로(무료·무제한) 이 Worker는 /api 요청만 처리한다.
//
// 무료 플랜 한도 안에 들도록:
// - 요청당 CPU 10ms: Worker는 점수를 계산하지 않고, 미리 이어 붙여 둔 문자열을 그대로 내려준다.
// - D1 읽기 하루 500만 행: 요청 하나가 읽는 행은 많아야 10~20개(조각 단위로 저장).
// - D1 쓰기 하루 10만 행: 수집 1회에 4~5행, 하루 약 7천 행.
//
// 저장 구조(worker/schema.sql)
// - obs: 관측 원본. 사이트별 1분 1행. 백업과 재계산용.
// - blob: 화면용 조각. 관측 한 줄(JSON + ",")을 계속 이어 붙인다.
//   h:<UTC 시각, 시간 단위>  그 1시간의 1분 간격 관측(최근 8시간만 보관)
//   d:<KST 날짜>             그날의 5분 간격 관측(00:05 ~ 다음 날 00:00 수집. 마지막 00:00 수집이 그날 마감값)
import * as melon from "./adapters/melon.js";
import * as berriz from "./adapters/berriz.js";
import { MIN, HOUR, KST_OFFSET } from "../site/core/time.js";

const ADAPTERS = { melon, berriz };
const SAMPLE = Object.values(ADAPTERS).some(a => a.SAMPLE);
const HOUR_KEEP = 8;

export const kstDate = ts => new Date(ts + KST_OFFSET).toISOString().slice(0, 10);
export const hourKey = ts => "h:" + new Date(Math.floor(ts / HOUR) * HOUR).toISOString().slice(0, 13);
export const dayKey = ts => "d:" + kstDate(ts);
// 5분마다(정각 기준) 관측을 하루 조각에 넣는다. 00:00 수집은 전날의 마감값이라 전날 조각에 들어간다.
export const dayBlobKey = at => at % (5 * MIN) === 0 ? dayKey(at - 1) : null;
const APPEND = "INSERT INTO blob (k, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET body = body || excluded.body, updated_at = excluded.updated_at";

async function collect(env, at) {
  const results = await Promise.all(Object.entries(ADAPTERS).map(async ([source, ad]) => {
    try {
      let prev = null;
      if (ad.NEEDS_PREV) {
        const row = await env.DB.prepare("SELECT observed_at, candidates FROM obs WHERE source = ? ORDER BY observed_at DESC LIMIT 1").bind(source).first();
        if (row) prev = { observedAt: row.observed_at, candidates: JSON.parse(row.candidates) };
      }
      const o = await ad.collect({ env, now: Date.now(), prev });
      return { source, observedAt: o.observedAt, sourceAt: o.sourceAt ?? null, totalVotes: o.totalVotes ?? null, candidates: o.candidates };
    } catch (e) {
      // 실패한 사이트는 이번 관측을 건너뛴다. 화면은 마지막 정상값을 "N분 전 값"으로 보여 준다.
      console.error(source + " 수집 실패", e && e.message);
      return null;
    }
  }));
  const ok = results.filter(Boolean);
  if (!ok.length) return;

  const lines = ok.map(o => JSON.stringify(o) + ",").join("");
  const stmts = ok.map(o => env.DB.prepare("INSERT OR IGNORE INTO obs (source, observed_at, source_at, total_votes, candidates) VALUES (?, ?, ?, ?, ?)")
    .bind(o.source, o.observedAt, o.sourceAt, o.totalVotes, JSON.stringify(o.candidates)));
  stmts.push(env.DB.prepare(APPEND).bind(hourKey(at), lines, at));
  const dk = dayBlobKey(at);
  if (dk) stmts.push(env.DB.prepare(APPEND).bind(dk, lines, at));
  if (Math.floor(at / MIN) % 60 === 30) stmts.push(env.DB.prepare("DELETE FROM blob WHERE k LIKE 'h:%' AND updated_at < ?").bind(at - HOUR_KEEP * HOUR));
  await env.DB.batch(stmts);
}

function json(rows, now, maxAge) {
  const body = rows.map(r => r.body).join("");
  return new Response(`{"now":${now},"sample":${SAMPLE},"lines":[${body.slice(0, -1)}]}`, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}` }
  });
}
const error = (status, msg) => new Response(JSON.stringify({ error: msg }), { status, headers: { "content-type": "application/json; charset=utf-8" } });

async function blobs(env, keys) {
  const { results } = await env.DB.prepare(`SELECT body FROM blob WHERE k IN (${keys.map(() => "?").join(",")})`).bind(...keys).all();
  return results;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collect(env, Math.round(event.scheduledTime / MIN) * MIN));
  },

  async fetch(req, env) {
    if (req.method !== "GET") return error(405, "GET만 지원합니다");
    const url = new URL(req.url), now = Date.now();
    try {
      switch (url.pathname) {
        case "/api/latest":
          return json(await blobs(env, [hourKey(now), hourKey(now - HOUR)]), now, 30);
        case "/api/live": {
          const keys = [dayKey(now)];
          for (let i = 0; i < HOUR_KEEP; i++) keys.push(hourKey(now - i * HOUR));
          return json(await blobs(env, keys), now, 30);
        }
        case "/api/history": {
          const before = url.searchParams.get("before") || "";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return error(400, "before=YYYY-MM-DD 가 필요합니다");
          const { results } = await env.DB.prepare("SELECT body FROM blob WHERE k >= 'd:' AND k < ? ORDER BY k").bind("d:" + before).all();
          return json(results, now, 600);
        }
        default:
          return error(404, "없는 주소입니다");
      }
    } catch (e) {
      console.error("API 오류", e && e.message);
      return error(503, "잠시 데이터를 읽을 수 없습니다");
    }
  }
};
