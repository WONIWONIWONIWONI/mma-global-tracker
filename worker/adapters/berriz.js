// 베리즈 어댑터: 원본 응답 → 공통 형식 { observedAt, sourceAt|null, totalVotes, candidates: { 후보id: 득표수 } }
// 투표 주소 공개 전이라 가짜 데이터를 만든다. 공개되면 실제 응답을 fetch로 받아
// site/core/config.js 의 siteIds.berriz 로 후보를 매칭하도록 바꾸고 SAMPLE, NEEDS_PREV 를 false로 한다.
// 매칭되지 않는 후보는 candidates에서 빼고(0으로 채우지 않음), 형식이 이상하면 throw 해서 이번 관측을 건너뛴다.
import { fakeNext } from "../../site/core/fakeSource.js";

export const SAMPLE = true;
export const NEEDS_PREV = true;

export async function collect({ now, prev }) {
  return fakeNext("berriz", prev, now);
}
