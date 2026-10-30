// 후보·점수 규칙·수집 기준. 화면과 Worker가 같이 쓴다.
import { MIN } from "./time.js";

// 투표 기간(KST). 두 사이트 공지: 10/30 10:00 ~ 11/13 23:59:59.
// 실제 수집기는 이 기간(앞뒤 여유 포함)에만 사이트를 조회하고, 백업은 시작일부터 한다.
export const VOTE = { start: "2026-10-30T10:00:00+09:00", end: "2026-11-14T00:00:00+09:00" };

// 후보: 10/30 공개된 실제 30팀. 음원 점수는 사용자가 준 "예측"(@kowartermelon 예측표, 10/14 기준 30팀, 10/30 반영).
// 예측표에 없는 팀은 chart: null(합산 순위 없이 따로 표시).
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
  c("enhypen", "ENHYPEN", 38.17, "2899079", "ENHYPEN"),
  c("exo", "EXO", 37.37, "724619", "EXO"),
  c("nmixx", "NMIXX", 34.88, "3070786", "NMIXX"),
  c("newjeans", "NewJeans", 33.85, "3114174", "NewJeans"),
  c("babymonster", "BABYMONSTER", 33.02, "3619984", "BABYMONSTER"),
  c("tws", "TWS", 30.90, "3679688", "TWS"),
  c("jennie", "JENNIE", 29.62, "995173", "JENNIE"),
  c("nctdream", "NCT DREAM", 28.13, "1066419", "NCT DREAM"),
  // 예측표(30팀)에 없는 실제 후보: 음원 점수 미확인(합산 순위 없이 따로 표시). 예측표에는 대신 NCT 127(25.25)과
  // Red Velvet(25.00)이 있었는데 실제 후보가 아니다.
  c("rose", "ROSÉ", null, "995171", "ROSÉ"),
  c("yena", "YENA", null, "2399724", "YENA")
];

export const SITES = { melon: "멜론", berriz: "베리즈" };

export const RULES = {
  cutoff: 10,          // TOP10 경계
  siteMax: 10,         // 사이트별 투표 만점
  judgeScore: 20,      // 비공개 심사 점수(계산에서 뺌)
  // 음원 점수를 합산에 넣을지(10/30 오전에는 예측 점수가 없어 false로 투표 점수만 보여 줬다).
  // false: 투표 점수(멜론 10 + 베리즈 10)만 합산한 20점 만점 순위, 30팀 모두 순위를 매김.
  // true:  음원 + 멜론 + 베리즈 80점 만점 잠정 순위(음원 점수 없는 팀은 "음원 점수 미확인"으로 따로).
  useChart: true,      // 10/30 오후: 30팀 예측 음원 점수를 받아 켬
  chartMax: 60,        // 음원 점수 만점(합산 비중 60%)
  get provisionalMax() { return (this.useChart ? this.chartMax : 0) + 2 * this.siteMax; },   // 화면 합산 만점
  chartEstimated: true // 음원 점수가 공식 값이 아니라 예측값이면 true(화면에 "예측" 표시)
};

// 수집 주기(2026-10-30): 멜론은 Cloudflare가 20초마다(원본이 실시간), 베리즈는 GitHub Actions가 10분마다
// (원본이 10분마다 집계: 00·10·20…분). 그래서 기준을 사이트별로 둔다.
export const COLLECT = {
  everySec: { melon: 20, berriz: 600 },            // 화면 안내용 수집 간격
  staleMs: { melon: 3 * MIN, berriz: 20 * MIN },   // 마지막 관측이 이보다 오래되면 "N분 전 값"으로 표시
  gapMs: { melon: 10 * MIN, berriz: 25 * MIN },    // 이보다 오래 관측이 없으면 그 구간은 빈 값(0으로 채우지 않음)
  maxSkewMs: 25 * MIN  // 두 사이트 관측 시각 차이가 이보다 크면 합산 보류(베리즈는 원래 10분 간격이라 넉넉히)
};

export const PIN_DEFAULT = "rescene";

// 점검 중(2026-10-30 사용자 요청): 30팀 예측 음원 점수와 베리즈 수집 방법이 정해질 때까지 닫아 둔다.
// 베리즈는 GitHub 수집으로 해결돼 10/30 10:40에 열었다. 글로벌 TOP10은 10/30 사용자 요청으로
// 음원 점수 없이 투표 점수만 합산해 열었다(RULES.useChart = false).
// tabs: 화면에서 잠글 탭(눌러도 열리지 않고 "점검 중" 표시), sites: 상태줄에 "점검 중"으로 보이고 상태 확인(health.py)이 건너뛸 사이트.
// 다시 열 때는 이 목록에서 빼면 된다.
export const MAINTENANCE = { tabs: [], sites: [] };
