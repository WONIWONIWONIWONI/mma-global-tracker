// Cloudflare Worker: 멜론을 20초마다 수집하고, GitHub Actions가 10분마다 보내는 베리즈 집계를 받아 D1에 쌓는다.
// /api 요청에는 관측 조각을 내려준다. 화면 파일(site/)은 정적 자산으로 따로 나가므로(무료·무제한) 여기 오지 않는다.
//
// 수집 방식(2026-10-30)
// - 멜론: Cron 1분마다 실행 → 한 번 실행 안에서 0·20·40초에 세 번 조회(Cron은 1분보다 짧게 못 돌린다).
// - 베리즈: Cloudflare에서 요청하면 베리즈가 거절(403)한다. GitHub Actions(scripts/berriz_collect.py)가
//   10분 집계(00·10·20…분)마다 조회해 POST /api/ingest/berriz 로 보낸다(비밀값 INGEST_TOKEN 확인).
//
// 무료 플랜 한도 안에 들도록:
// - 요청당 CPU 10ms: Worker는 점수를 계산하지 않고, 미리 이어 붙여 둔 문자열을 그대로 내려준다.
// - D1 읽기 하루 500만 행: 요청 하나가 읽는 행은 많아야 10~20개(조각 단위로 저장).
// - D1 쓰기 하루 10만 행: 멜론 분당 약 7행 + 베리즈 10분에 4행 → 하루 약 1만 1천 행.
//
// 저장 구조(worker/schema.sql)
// - obs: 관측 원본(멜론 20초, 베리즈 10분 1행). 백업과 재계산용.
// - blob: 화면용 조각. 관측 한 줄(JSON + ",")을 계속 이어 붙인다.
//   h:<UTC 시각, 시간 단위>  그 1시간의 관측(멜론은 매분 0초 것만, 베리즈는 전부). 최근 8시간만 보관
//   d:<KST 날짜>             그날의 관측(멜론 5분 간격, 베리즈 10분 집계 전부). 00:00 값은 전날의 마감값
//   l:<사이트>               가장 최근 관측 한 줄(덮어씀). 20초 수집 값이 화면에 바로 나가게
//   m:usage                  요청 사용량과 화면 갱신 간격(JSON 한 덩어리, 덮어씀)
//
// API: /api/init(처음 1회: 오늘 + 지난 날짜 목록), /api/latest(이후 갱신), /history/날짜.json(끝난 날, 정적 파일이 없을 때만)
// 응답 {now, sample, refreshSec, days?, lines:[관측...]}
import * as melon from "./adapters/melon.js";
import * as berriz from "./adapters/berriz.js";
import { MIN, HOUR, KST_OFFSET } from "../site/core/time.js";
import { VOTE } from "../site/core/config.js";

const SAMPLE = melon.SAMPLE;
const HOUR_KEEP = 8;
const MELON_OFFSETS = [0, 20, 40];   // 1분 안에서 멜론을 읽는 초

export const kstDate = ts => new Date(ts + KST_OFFSET).toISOString().slice(0, 10);
export const hourKey = ts => "h:" + new Date(Math.floor(ts / HOUR) * HOUR).toISOString().slice(0, 13);
export const dayKey = ts => "d:" + kstDate(ts);
// 5분마다(정각 기준) 관측을 하루 조각에 넣는다. 00:00 수집은 전날의 마감값이라 전날 조각에 들어간다.
export const dayBlobKey = at => at % (5 * MIN) === 0 ? dayKey(at - 1) : null;
const APPEND = "INSERT INTO blob (k, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET body = body || excluded.body, updated_at = excluded.updated_at";
const PUT = "INSERT INTO blob (k, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 관측 하나를 저장하는 문장들: 원본(obs) + 최신값(l:) + 지정한 조각(h:, d:)에 이어 붙이기
function storeStmts(env, o, appendKeys, at, latest = true) {
  const line = JSON.stringify(o) + ",";
  return [
    env.DB.prepare("INSERT OR IGNORE INTO obs (source, observed_at, source_at, total_votes, candidates) VALUES (?, ?, ?, ?, ?)")
      .bind(o.source, o.observedAt, o.sourceAt, o.totalVotes, JSON.stringify(o.candidates)),
    ...(latest ? [env.DB.prepare(PUT).bind("l:" + o.source, line, at)] : []),
    ...appendKeys.map(k => env.DB.prepare(APPEND).bind(k, line, at))
  ];
}

const auth = (env, req) => !!env.INGEST_TOKEN && (req.headers.get("authorization") || "") === "Bearer " + env.INGEST_TOKEN;
const minuteSlot = ts => Math.floor((ts + 5000) / MIN) * MIN;   // site/core/history.js slotOf 와 같은 기준
const MELON_BATCH = 15;   // 한 번에 받는 관측 수(무료 플랜 D1 쿼리 수 한도 50 안에서)

// 멜론 보조 수집: GitHub Actions가 1분마다 읽은 값을 5분마다 묶어 보낸다. Cloudflare 수집이 이미 있는 분은 버리고,
// 빠진 분(한도 초과·Cron 누락 등)만 채운다. 보내기가 실패하면 GitHub이 보관했다가 다시 보낸다.
// 본문 {items:[{observedAt, nominees:[{id, voteCount}]}]}
async function ingestMelon(env, req, now) {
  if (!auth(env, req)) return error(401, "인증 실패");
  const text = await req.text();
  if (text.length > 200000) return error(413, "너무 큼");
  let items;
  try { items = JSON.parse(text).items; } catch { return error(400, "형식 오류"); }
  if (!Array.isArray(items) || items.length > MELON_BATCH) return error(400, `items는 ${MELON_BATCH}개 이하`);
  const lo = Date.parse(VOTE.start) - 10 * MIN, hi = Math.min(now + MIN, Date.parse(VOTE.end) + 30 * MIN);
  items = items.filter(x => Number.isFinite(x?.observedAt) && x.observedAt >= lo && x.observedAt <= hi).sort((a, b) => a.observedAt - b.observedAt);
  if (!items.length) return ok({ stored: 0, skipped: 0 });

  const from = minuteSlot(items[0].observedAt) - 5000, to = minuteSlot(items[items.length - 1].observedAt) + MIN - 5000;
  const have = await env.DB.prepare("SELECT observed_at FROM obs WHERE source = 'melon' AND observed_at >= ? AND observed_at < ?").bind(from, to).all();
  const slots = new Set(have.results.map(r => minuteSlot(r.observed_at)));
  const stmts = [];
  let stored = 0, skipped = 0;
  for (const x of items) {
    const slot = minuteSlot(x.observedAt);
    if (slots.has(slot)) { skipped++; continue; }
    let p;
    try { p = melon.parse(x.nominees); } catch (e) { skipped++; continue; }
    slots.add(slot);
    const o = { source: "melon", observedAt: x.observedAt, sourceAt: null, totalVotes: p.totalVotes, candidates: p.candidates };
    const keys = [];
    if (now - x.observedAt < HOUR_KEEP * HOUR) keys.push(hourKey(x.observedAt));
    const dk = dayBlobKey(slot); if (dk) keys.push(dk);
    stmts.push(...storeStmts(env, o, keys, now, now - x.observedAt < 2 * MIN));
    stored++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return ok({ stored, skipped });
}

// 멜론: 이번 분의 0·20·40초에 조회. 0초 값만 h:·d: 조각에 넣고(그래프·기록은 1분 간격 유지), 20·40초 값은 최신값으로만.
async function collectMelon(env, at) {
  for (const off of MELON_OFFSETS) {
    const due = at + off * 1000;
    if (Date.now() < due) await sleep(due - Date.now());
    if (Date.now() > due + 15000) continue;   // 많이 늦었으면 건너뜀(다음 분과 겹치지 않게)
    try {
      const r = await melon.collect({ now: Date.now() });
      const o = { source: "melon", observedAt: r.observedAt, sourceAt: r.sourceAt ?? null, totalVotes: r.totalVotes ?? null, candidates: r.candidates };
      const keys = [];
      if (off === 0) { keys.push(hourKey(at)); const dk = dayBlobKey(at); if (dk) keys.push(dk); }
      const stmts = storeStmts(env, o, keys, at);
      if (off === 0 && Math.floor(at / MIN) % 60 === 30) stmts.push(env.DB.prepare("DELETE FROM blob WHERE k LIKE 'h:%' AND updated_at < ?").bind(at - HOUR_KEEP * HOUR));
      await env.DB.batch(stmts);
    } catch (e) {
      // 실패하면 이번 관측만 건너뛴다. 화면은 마지막 정상값을 "N분 전 값"으로 보여 준다.
      console.error("melon 수집 실패", e && e.message);
    }
  }
}

// 베리즈: GitHub Actions가 보낸 원본 응답을 받아 저장. 같은 집계(같은 aggregatedAt)는 한 번만 저장한다.
async function ingestBerriz(env, req, now) {
  if (!auth(env, req)) return error(401, "인증 실패");
  if (now < Date.parse(VOTE.start) - 10 * MIN || now > Date.parse(VOTE.end) + 30 * MIN) return error(409, "투표 기간이 아닙니다");
  const text = await req.text();
  if (text.length > 100000) return error(413, "너무 큼");
  let p;
  try { p = berriz.parse(JSON.parse(text)); } catch (e) { return error(400, "형식 오류: " + (e && e.message)); }
  if (!p) return ok({ stored: false, reason: "아직 집계 전" });
  const last = await env.DB.prepare("SELECT source_at FROM obs WHERE source = 'berriz' ORDER BY observed_at DESC LIMIT 1").first();
  if (last && p.sourceAt != null && last.source_at != null && p.sourceAt <= last.source_at) return ok({ stored: false, reason: "같은 집계", sourceAt: p.sourceAt });
  // 관측 시각: GitHub이 실제로 읽은 시각(밀렸다 다시 보낼 때도 정확하게). 이상한 값이면 받은 시각.
  const sent = Number(req.headers.get("x-observed-at"));
  const observedAt = Number.isFinite(sent) && sent <= now && (p.sourceAt == null || sent >= p.sourceAt) ? sent : now;
  const o = { source: "berriz", observedAt, sourceAt: p.sourceAt, totalVotes: p.totalVotes, candidates: p.candidates };
  // 집계 시각 기준 날짜(00:00 집계는 전날 마감값). 오래 밀린 값은 최근 8시간 조각에 넣지 않는다.
  const keys = [dayKey((p.sourceAt ?? observedAt) - 1)];
  if (now - observedAt < HOUR_KEEP * HOUR) keys.push(hourKey(observedAt));
  await env.DB.batch(storeStmts(env, o, keys, now, now - observedAt < 15 * MIN));
  return ok({ stored: true, sourceAt: p.sourceAt, teams: Object.keys(p.candidates).length });
}

/* ───────── 요청 한도 지키기: 남은 한도에 맞춰 화면 갱신 간격을 정한다 ─────────
 * Workers 무료 플랜은 계정 전체 하루 10만 요청(UTC 00시 = KST 09시 초기화).
 * - 오늘 쓴 양(used): 5분마다 Cloudflare 사용량 통계(GraphQL)로 확인 → m:usage. 통계는 몇 분 늦다.
 * - 지금 속도(rate): API 요청 8번에 1번꼴로 그 분의 칸(c:<분>)에 8을 더해 둔다(쓰기 한도를 아끼는 표본 집계).
 *   통계를 기다리지 않아 사람이 갑자기 몰려도 1~2분 안에 반응한다(2026-10-30, 전에는 15~20분 걸림).
 * - 매분 Cron이 최근 3분 속도와 오늘 쓴 양으로, 남은 한도를 초기화까지 고르게 쓰는 가장 짧은 간격(20~600초)을 정해
 *   m:refresh 에 둔다. 화면은 API 응답의 refreshSec 를 따른다.
 * 비밀값 CF_API_TOKEN·CF_ACCOUNT_ID 가 없으면 오늘 쓴 양을 속도로만 어림한다.
 */
const DAILY_LIMIT = 100000, RESERVE = 0.1, REFRESH_MIN = 20, REFRESH_MAX = 600;
const USAGE_KEY = "m:usage", REFRESH_KEY = "m:refresh";
const COUNT_EVERY = 8;     // API 요청 표본 비율(1/8)
const FIXED_PER_MIN = 3;   // 화면과 무관한 고정 요청(Cron 1 + GitHub 보조 수집 등) 분당 어림값

// API 요청 수 표본 집계(c:<분> 칸에 COUNT_EVERY씩). 응답을 늦추지 않게 waitUntil로 뒤에서 쓴다.
function countRequest(env, ctx, now) {
  if (Math.random() * COUNT_EVERY >= 1) return;
  ctx.waitUntil(env.DB.prepare("INSERT INTO blob (k, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET body = CAST(blob.body AS INTEGER) + ?, updated_at = excluded.updated_at")
    .bind("c:" + Math.floor(now / MIN), String(COUNT_EVERY), now, COUNT_EVERY).run().catch(e => console.error("요청 집계 실패", e && e.message)));
}

const roundSec = s => s < 60 ? Math.ceil(s / 10) * 10 : Math.ceil(s / 30) * 30;   // 1분 미만 10초, 그 이상 30초 단위

// 매분: 최근 속도와 오늘 쓴 양으로 화면 갱신 간격을 정한다.
export async function adjustRefresh(env, at) {
  try {
    const m = Math.floor(at / MIN), keys = [1, 2, 3].map(i => "c:" + (m - i));
    const [cnt, usage, cur] = await env.DB.batch([
      env.DB.prepare("SELECT k, body FROM blob WHERE k IN (?, ?, ?)").bind(...keys),
      env.DB.prepare("SELECT body FROM blob WHERE k = ?").bind(USAGE_KEY),
      env.DB.prepare("SELECT body FROM blob WHERE k = ?").bind(REFRESH_KEY)
    ]);
    const byKey = Object.fromEntries(cnt.results.map(r => [r.k, Number(r.body) || 0]));
    const counts = keys.map(k => byKey[k] || 0);
    // 최근 3분 평균과 직전 1분 중 큰 값(갑자기 늘 때 바로 반응)
    const rate = Math.max(counts.reduce((s, n) => s + n, 0) / 3, counts[0]);
    const prev = cur.results[0] ? (JSON.parse(cur.results[0].body).refreshSec || REFRESH_MIN) : REFRESH_MIN;
    const dayStart = Math.floor(at / 864e5) * 864e5, dayEnd = dayStart + 864e5;
    const u = usage.results[0] ? JSON.parse(usage.results[0].body) : null;
    // 오늘 쓴 양: 통계값 + 통계 확인 뒤 지금까지 속도로 어림. 통계가 없거나 어제 것이면 속도로만 어림.
    const used = u && u.checkedAt >= dayStart
      ? u.used + (at - u.checkedAt) / MIN * (rate + FIXED_PER_MIN)
      : (at - dayStart) / MIN * (rate + FIXED_PER_MIN);
    const left = DAILY_LIMIT * (1 - RESERVE) - used, minutesLeft = (dayEnd - at) / MIN;
    const allowed = left / minutesLeft - FIXED_PER_MIN;   // 화면 요청에 쓸 수 있는 분당 요청 수
    // 지금 간격(prev초)에서 분당 rate 요청이 왔다면 x초 간격일 때는 rate × prev / x. 이게 allowed 이하가 되는 가장 짧은 x.
    let refreshSec = left <= 0 || allowed <= 0 ? REFRESH_MAX : roundSec(rate * prev / allowed);
    // 늘릴 때는 바로, 줄일 때는 1분에 절반까지만(한꺼번에 줄였다가 다시 몰리는 출렁임 방지)
    refreshSec = Math.max(refreshSec || REFRESH_MIN, roundSec(prev / 2));
    refreshSec = Math.min(REFRESH_MAX, Math.max(REFRESH_MIN, refreshSec));
    const stmts = [env.DB.prepare("DELETE FROM blob WHERE k >= 'c:' AND k < 'c;' AND updated_at < ?").bind(at - 10 * MIN)];
    if (refreshSec !== prev || !cur.results[0] || m % 10 === 0)
      stmts.push(env.DB.prepare(PUT).bind(REFRESH_KEY, JSON.stringify({ refreshSec, rate: Math.round(rate), used: Math.round(used), at }), at));
    await env.DB.batch(stmts);
  } catch (e) {
    console.error("갱신 간격 계산 실패", e && e.message);   // 실패하면 마지막 값을 그대로 쓴다
  }
}

// 오늘(UTC) 요청 수를 15분 묶음으로 한 번에 가져온다(통계 API 조회 횟수를 아끼려고 한 번만 묻는다).
async function usageToday(env, dayStart, at) {
  const query = "query($a:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:200,filter:{datetime_geq:$s,datetime_leq:$u}){sum{requests} dimensions{datetimeFifteenMinutes}}}}}";
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: "Bearer " + env.CF_API_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { a: env.CF_ACCOUNT_ID, s: new Date(dayStart).toISOString(), u: new Date(at).toISOString() } })
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error("사용량 조회 실패: " + JSON.stringify(j.errors || r.status).slice(0, 200));
  const buckets = new Map();
  for (const x of j.data.viewer.accounts[0].workersInvocationsAdaptive) {
    const t = Date.parse(x.dimensions.datetimeFifteenMinutes);
    buckets.set(t, (buckets.get(t) || 0) + x.sum.requests);
  }
  return [...buckets.values()].reduce((s, n) => s + n, 0);
}

// 5분마다: 오늘 쓴 요청 수를 통계로 확인해 m:usage 에 둔다(갱신 간격은 매분 adjustRefresh가 정함).
export async function checkUsage(env, at) {
  try {
    const dayStart = Math.floor(at / 864e5) * 864e5;
    const used = await usageToday(env, dayStart, at);
    await env.DB.prepare(PUT).bind(USAGE_KEY, JSON.stringify({ used, checkedAt: at }), at).run();
  } catch (e) {
    console.error("사용량 확인 실패", e && e.message);   // 실패하면 마지막 값을 그대로 쓴다
  }
}

// 저장된 갱신 간격. 10분 넘게 갱신이 안 됐으면(Cron 문제 등) 120초로 무난하게.
function refreshFrom(row, now) {
  if (!row) return REFRESH_MIN;
  try { const u = JSON.parse(row.body); return now - u.at > 10 * MIN ? 120 : u.refreshSec; } catch { return REFRESH_MIN; }
}

/* ───────── API ───────── */
const error = (status, msg) => new Response(JSON.stringify({ error: msg }), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const ok = obj => new Response(JSON.stringify({ ok: true, ...obj }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const LATEST_KEYS = ["l:melon", "l:berriz"];

const json = (body, maxAge) => new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}` } });
const joinLines = rows => rows.map(r => r.body).join("").slice(0, -1);
const INIT_HOURS = 7;   // 처음 열 때 주는 1분 간격 구간(화면의 6시간 그래프 + 여유)

// /api/init, /api/latest: 조각(keys)과 갱신 간격. withDays면 지난 날짜 목록도 준다(내용은 /history/날짜.json 으로 따로 받음).
// 응답 크기가 투표 기간 길이와 상관없이 하루치 이하로 묶여 무료 플랜 CPU 한도(요청당 10ms)를 넘지 않는다.
async function respond(env, now, keys, withDays, maxAge = 30) {
  keys = [...keys, ...LATEST_KEYS];   // 20초 수집 최신값(같은 관측이 겹쳐도 화면이 관측 시각으로 하나만 남긴다)
  const stmts = [
    // ORDER BY k: d: → h: → l: 순서(화면은 관측 시각으로 다시 정렬하지만 응답을 일정하게)
    env.DB.prepare(`SELECT body FROM blob WHERE k IN (${keys.map(() => "?").join(",")}) ORDER BY k`).bind(...keys),
    env.DB.prepare("SELECT body FROM blob WHERE k = ?").bind(REFRESH_KEY)
  ];
  if (withDays) stmts.push(env.DB.prepare("SELECT k FROM blob WHERE k >= 'd:' AND k < ? ORDER BY k").bind(dayKey(now)));
  const [blobs, meta, days] = await env.DB.batch(stmts);
  const dayList = days ? `"days":${JSON.stringify(days.results.map(r => r.k.slice(2)))},` : "";
  return json(`{"now":${now},"sample":${SAMPLE},"refreshSec":${refreshFrom(meta.results[0], now)},${dayList}"lines":[${joinLines(blobs.results)}]}`, maxAge);
}

// /history/YYYY-MM-DD.json: 끝난 날짜의 5분 간격 관측. 보통은 매일 밤 GitHub Actions가 만든 정적 파일이 먼저 나가고
// (무료·무제한, 이 Worker를 거치지 않음), 아직 파일이 없을 때만 여기서 D1로 대신 답한다.
async function history(env, now, day) {
  if (day >= kstDate(now)) return error(404, "끝난 날짜만 있습니다");
  const row = await env.DB.prepare("SELECT body FROM blob WHERE k = ?").bind("d:" + day).first();
  if (!row) return error(404, "그날 기록이 없습니다");
  // 날짜가 막 바뀐 직후에는 마지막(00:00) 관측이 늦게 붙을 수 있어 잠깐만 캐시한다
  const justEnded = now - (Date.parse(day + "T00:00:00+09:00") + 864e5) < 15 * MIN;
  return json(`{"day":"${day}","lines":[${joinLines([row])}]}`, justEnded ? 120 : 86400);
}

export default {
  async scheduled(event, env, ctx) {
    const at = Math.round(event.scheduledTime / MIN) * MIN;
    // 실제 수집은 투표 기간(시작 10분 전 ~ 종료 30분 뒤)에만 한다.
    const inVote = at >= Date.parse(VOTE.start) - 10 * MIN && at <= Date.parse(VOTE.end) + 30 * MIN;
    if (SAMPLE || inVote) ctx.waitUntil(collectMelon(env, at));
    if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID && at % (5 * MIN) === 2 * MIN) ctx.waitUntil(checkUsage(env, at));
    ctx.waitUntil(adjustRefresh(env, at));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url), now = Date.now();
    if (req.method === "GET") countRequest(env, ctx, now);
    if (req.method === "POST" && url.pathname === "/api/ingest/berriz") {
      try { return await ingestBerriz(env, req, now); }
      catch (e) { console.error("베리즈 받기 오류", e && e.message); return error(503, "저장 실패"); }
    }
    if (req.method === "POST" && url.pathname === "/api/ingest/melon") {
      try { return await ingestMelon(env, req, now); }
      catch (e) { console.error("멜론 보조 받기 오류", e && e.message); return error(503, "저장 실패"); }
    }
    if (req.method !== "GET") return error(405, "GET만 지원합니다");
    try {
      const h = url.pathname.match(/^\/history\/(\d{4}-\d{2}-\d{2})\.json$/);
      if (h) return await history(env, now, h[1]);
      switch (url.pathname) {
        // 처음 열 때 한 번: 오늘의 5분 간격 + 최근 7시간의 1분 간격 + 지난 날짜 목록
        case "/api/init": {
          const keys = [dayKey(now)];
          for (let i = 0; i < INIT_HOURS; i++) keys.push(hourKey(now - i * HOUR));
          return await respond(env, now, keys, true);
        }
        // 5분마다: 최근 2시간의 1분 간격(그래프·기록용)
        case "/api/latest":
          return await respond(env, now, [hourKey(now), hourKey(now - HOUR)], false);
        // 그 사이 갱신마다: 사이트별 최신 관측 한 줄씩(l: 조각만, 1~2KB)
        case "/api/now":
          return await respond(env, now, [], false, 10);   // 20초 갱신이 브라우저 캐시에 막히지 않게 짧게
        default:
          return error(404, "없는 주소입니다");
      }
    } catch (e) {
      console.error("API 오류", e && e.message);
      return error(503, "잠시 데이터를 읽을 수 없습니다");
    }
  }
};
