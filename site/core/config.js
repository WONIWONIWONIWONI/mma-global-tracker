// 후보·점수 규칙·수집 기준. 화면과 Worker가 같이 쓴다.
import { MIN } from "./time.js";

// 투표 기간(KST). 두 사이트 공지: 10/30 10:00 ~ 11/13 23:59:59.
// 실제 수집기는 이 기간(앞뒤 여유 포함)에만 사이트를 조회하고, 백업은 시작일부터 한다.
export const VOTE = { start: "2026-10-30T10:00:00+09:00", end: "2026-11-14T00:00:00+09:00" };

// 후보: 10/30 공개된 실제 30팀. 음원 점수는 사용자가 정리한 "예측"(상위 20팀만), 나머지는 chart: null(합산 순위에서 따로 표시).
// siteIds: 각 사이트 응답에서 이 후보를 가리키는 값. 이름·순위로 추정하지 않고 직접 적는다.
//   melon: 멜론 아티스트 ID(category.json 의 content.id), berriz: 베리즈 후보 이름(stats 의 name, 영문 그대로)
const c = (id, name, chart, melon, berriz) => ({ id, name, chart, siteIds: { melon, berriz } });
export const CANDIDATES = [
  c("bts", "BTS", 60.00, "672375", "BTS"),
  c("aespa", "aespa", 59.28, "2899555", "aespa"),
  c("bigbang", "BIGBANG", 54.90, "198094", "BIGBANG"),
  c("ive", "IVE", 54.19, "3055146", "IVE"),
  c("seventeen", "SEVENTEEN", 50.13, "861436", "SEVENTEEN"),
  c("cortis", "CORTIS", 48.36, "4491260", "CORTIS"),
  c("illit", "ILLIT", 47.73, "3743525", "ILLIT"),
  c("txt", "TXT", 46.70, "2632253", "TOMORROW X TOGETHER"),
  c("gdragon", "G-DRAGON", 46.49, "6984", "G-DRAGON"),
  c("nctwish", "NCT WISH", 46.09, "3574243", "NCT WISH"),
  c("riize", "RIIZE", 44.66, "3478478", "RIIZE"),
  c("twice", "TWICE", 43.14, "905701", "TWICE"),
  c("hearts2hearts", "Hearts2Hearts", 42.86, "4096106", "Hearts2Hearts"),
  c("lesserafim", "LE SSERAFIM", 42.82, "3092950", "LE SSERAFIM"),
  c("boynextdoor", "BOYNEXTDOOR", 42.37, "3458776", "BOYNEXTDOOR"),
  c("idle", "i-dle", 42.05, "2137482", "i-dle"),
  c("straykids", "Stray Kids", 41.80, "2006344", "Stray Kids"),
  c("iu", "IU", 39.80, "261143", "IU"),
  c("rescene", "RESCENE", 39.66, "3709231", "RESCENE"),
  c("blackpink", "BLACKPINK", 38.92, "995169", "BLACKPINK"),
  // 음원 점수 미확인(예측표 21위 이하)
  c("babymonster", "BABYMONSTER", null, "3619984", "BABYMONSTER"),
  c("enhypen", "ENHYPEN", null, "2899079", "ENHYPEN"),
  c("exo", "EXO", null, "724619", "EXO"),
  c("jennie", "JENNIE", null, "995173", "JENNIE"),
  c("nctdream", "NCT DREAM", null, "1066419", "NCT DREAM"),
  c("newjeans", "NewJeans", null, "3114174", "NewJeans"),
  c("nmixx", "NMIXX", null, "3070786", "NMIXX"),
  c("rose", "ROSÉ", null, "995171", "ROSÉ"),
  c("tws", "TWS", null, "3679688", "TWS"),
  c("yena", "YENA", null, "2399724", "YENA")
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

// 점검 중(2026-10-30 사용자 요청): 30팀 예측 음원 점수와 베리즈 수집 방법이 정해질 때까지 닫아 둔다.
// tabs: 화면에서 잠글 탭(눌러도 열리지 않고 "점검 중" 표시), sites: 수집을 멈출 사이트(Worker·상태 확인이 건너뜀).
// 다시 열 때는 이 목록에서 빼면 된다.
export const MAINTENANCE = { tabs: ["global", "berriz"], sites: ["berriz"] };
