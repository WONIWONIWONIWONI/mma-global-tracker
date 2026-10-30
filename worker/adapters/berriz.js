// 베리즈 어댑터: 원본 응답 → 공통 형식 { sourceAt, totalVotes, candidates: { 후보id: 득표수 } }
// 원본: 베리즈 투표 화면(https://berriz.in/ko/vote/mma2026/)이 쓰는 공개 집계 API
//   https://svc-api.berriz.in/service/v1/votes/mma2026/stats?languageCode=en
// 공지상 득표수는 10분마다 집계된다(00·10·20…분). aggregatedAt(집계 시각)을 sourceAt 으로 남긴다.
//
// 베리즈는 Cloudflare에서 오는 요청을 거절(HTTP 403)해서, 조회는 GitHub Actions(scripts/berriz_collect.py)가 하고
// 받은 원본 응답을 그대로 Worker의 /api/ingest/berriz 로 보낸다. Worker는 여기 parse()로 바꿔 저장한다.
// 후보는 config.js 의 siteIds.berriz(후보 이름, 영문)로 매칭한다. 응답에 없는 후보는 빼고(0으로 채우지 않음),
// 아직 첫 집계 전이면(득표수가 비어 있음) null, 형식이 이상하면 throw.
import { CANDIDATES } from "../../site/core/config.js";

export const SAMPLE = false;

const norm = s => String(s ?? "").normalize("NFC").trim().toLowerCase();

export function parse(j) {
  if (j?.code !== "0000" || !Array.isArray(j?.data?.candidates)) throw new Error("응답 형식이 다름: " + String(j?.code));
  const d = j.data;

  const byName = new Map();
  for (const x of d.candidates) if (Number.isFinite(x?.voteCount)) byName.set(norm(x.name), x.voteCount);
  if (!byName.size) return null;   // 첫 집계 전(득표수 null)

  const candidates = {};
  for (const c of CANDIDATES) {
    const v = byName.get(norm(c.siteIds.berriz));
    if (v != null) candidates[c.id] = v;
  }
  if (Object.keys(candidates).length < CANDIDATES.length / 2) throw new Error(`후보 매칭이 너무 적음(${Object.keys(candidates).length}팀)`);
  const at = d.aggregatedAt;
  const sourceAt = typeof at === "number" ? at : (at ? Date.parse(at) || null : null);
  const totalVotes = Number.isFinite(d.totalVotes) ? d.totalVotes : Object.values(candidates).reduce((s, n) => s + n, 0);
  return { sourceAt, totalVotes, candidates };
}
