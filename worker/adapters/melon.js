// 멜론 어댑터: 원본 응답 → 공통 형식 { observedAt, sourceAt|null, totalVotes, candidates: { 후보id: 득표수 } }
// 멜론 투표 화면(https://www.melon.com/mma/2026/vote/category/)이 쓰는 공개 집계 JSON을 20초에 한 번 읽는다
// (멜론 화면 자체는 약 10초마다 같은 파일을 다시 읽는다).
// 이 파일에는 12개 부문이 다 들어 있고, 글로벌 TOP10은 categoryId V26005. 득표수는 실시간으로 바뀐다(집계 시각 표시는 없음).
// 후보는 config.js 의 siteIds.melon(아티스트 ID)으로 매칭한다. 응답에 없는 후보는 빼고(0으로 채우지 않음),
// 형식이 이상하면 throw 해서 이번 관측을 건너뛴다(화면은 마지막 정상값을 "N분 전 값"으로 보여 줌).
import { CANDIDATES } from "../../site/core/config.js";

export const SAMPLE = false;

const URL = "https://m2.melon.com/m6/mma/2026/vote/category.json?lang=ko";
const CATEGORY = "V26005";

export async function collect({ now }) {
  // t: 멜론 화면과 같은 캐시 우회 값(초 단위)
  const r = await fetch(`${URL}&t=${Math.floor(now / 1000)}`, {
    headers: { accept: "application/json", referer: "https://www.melon.com/mma/2026/vote/category/", "user-agent": "mma-global-tracker (unofficial vote tracker; 3 req/min; +https://github.com/WONIWONIWONIWONI/mma-global-tracker)" },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const cat = j?.response?.categories?.find(x => x.categoryId === CATEGORY);
  if (!cat || !Array.isArray(cat.nominees)) throw new Error("글로벌 TOP10 부문이 응답에 없음");
  return { observedAt: now, sourceAt: null, ...parse(cat.nominees.map(n => ({ id: n?.content?.id, voteCount: n?.voteCount }))) };
}

// 후보 목록 [{id: 멜론 아티스트 ID, voteCount}] → { totalVotes, candidates }.
// Cloudflare 수집과 GitHub 보조 수집(scripts/berriz_collect.py가 같은 목록으로 줄여 보냄)이 같이 쓴다.
export function parse(nominees) {
  if (!Array.isArray(nominees)) throw new Error("후보 목록이 없음");
  const byId = new Map();
  let totalVotes = 0;
  for (const n of nominees) {
    const v = n?.voteCount;
    if (!Number.isFinite(v)) continue;
    byId.set(String(n.id), v);
    totalVotes += v;
  }
  const candidates = {};
  for (const c of CANDIDATES) {
    const v = byId.get(c.siteIds.melon);
    if (v != null) candidates[c.id] = v;
  }
  if (Object.keys(candidates).length < CANDIDATES.length / 2) throw new Error(`후보 매칭이 너무 적음(${Object.keys(candidates).length}팀)`);
  return { totalVotes, candidates };
}
