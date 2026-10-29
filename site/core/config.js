// 후보·점수 규칙·수집 기준. 화면과 Worker가 같이 쓴다.
import { MIN } from "./time.js";

// 투표 기간(KST). 30일 10시 시작, 11월 13일까지(종료 시각은 공지 확인 필요, 일단 13일 24시로 둔다).
// 실제 수집기는 이 기간(앞뒤 여유 포함)에만 사이트를 조회하고, 백업은 시작일부터 한다.
export const VOTE = { start: "2026-10-30T10:00:00+09:00", end: "2026-11-14T00:00:00+09:00" };

// 후보: 실제 30팀은 투표 시작일(10/30)에 공개된다. 아래 20팀과 음원 점수는 사용자가 정리한 "예측"이다.
// 공개되면 30팀 전체로 바꾸고, 음원 점수를 모르는 팀은 chart: null 로 둔다(합산 순위에서 따로 표시).
// siteIds: 각 사이트 응답에서 이 후보를 가리키는 ID. 이름·순위로 추정하지 않고 직접 적는다.
//          투표 주소가 공개되면 실제 응답을 보고 채운다. (가짜 데이터는 id를 그대로 쓴다)
const c = (id, name, chart) => ({ id, name, chart, siteIds: { melon: null, berriz: null } });
export const CANDIDATES = [
  c("bts", "BTS", 60.00), c("aespa", "aespa", 59.28), c("bigbang", "BIGBANG", 54.90), c("ive", "IVE", 54.19),
  c("seventeen", "SEVENTEEN", 50.13), c("cortis", "CORTIS", 48.36), c("illit", "ILLIT", 47.73), c("txt", "TXT", 46.70),
  c("gdragon", "G-Dragon", 46.49), c("nctwish", "NCT WISH", 46.09), c("riize", "RIIZE", 44.66), c("twice", "TWICE", 43.14),
  c("hearts2hearts", "Hearts2Hearts", 42.86), c("lesserafim", "LESSERAFIM", 42.82), c("boynextdoor", "BOYNEXTDOOR", 42.37),
  c("idle", "i-dle", 42.05), c("straykids", "Stray Kids", 41.80), c("iu", "IU", 39.80), c("rescene", "RESCENE", 39.66),
  c("blackpink", "BLACKPINK", 38.92)
];

export const SITES = { melon: "멜론", berriz: "베리즈" };

export const RULES = {
  cutoff: 10,          // TOP10 경계
  siteMax: 10,         // 사이트별 투표 만점
  judgeScore: 20,      // 비공개 심사 점수(계산에서 뺌)
  provisionalMax: 80,  // 화면 합산 만점(음원 60 + 멜론 10 + 베리즈 10)
  chartEstimated: true // 음원 점수가 공식 값이 아니라 예측값이면 true(화면에 "예측" 표시)
};

export const COLLECT = {
  staleMs: 3 * MIN,    // 마지막 관측이 이보다 오래되면 "N분 전 값"으로 표시
  maxSkewMs: 5 * MIN,  // 두 사이트 관측 시각 차이가 이보다 크면 합산 보류
  gapMs: 10 * MIN      // 이보다 오래 관측이 없으면 그 구간은 빈 값(0으로 채우지 않음)
};

export const PIN_DEFAULT = "rescene";
