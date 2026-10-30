# MMA 2026 글로벌 TOP10 트래커

멜론과 베리즈에서 동시에 진행되는 MMA 2026 글로벌 TOP10 투표를 실시간으로 수집하고,
음원 점수와 합쳐 잠정 순위를 보여주는 비공식 트래커를 만든다.

## 작업 방식 (사용자에 대해)

- 사용자는 코딩을 모른다. 설명은 쉬운 한국어로, 전문 용어는 풀어서 쓴다.
- 명령 실행, 배포, 커밋은 Claude가 직접 하고, 무엇을 했는지 한두 문장으로 알린다.
- 되돌리기 어려운 작업(데이터 삭제, 공개 저장소 변경, 유료 요금제 관련)은 하기 전에 먼저 묻는다.
- 사용자가 직접 해야 하는 일(로그인, 브라우저 승인 등)은 단계별로 짧게 안내한다.

## 최우선 규칙: 추가 결제가 절대 생기지 않게 한다

사용량이 한도를 넘더라도 요금이 청구되면 안 된다. 서비스가 잠시 멈추는 것은 괜찮고, 요금 청구는 안 된다.
(2026-10-29 공식 문서로 확인: Cloudflare 무료 플랜과 결제수단 없는 GitHub는 한도를 넘으면 오류가 나거나 막힐 뿐이고 요금이 청구되지 않는다)

- Cloudflare는 무료 플랜만 쓴다. Workers Paid 등 유료 업그레이드는 하지 않는다.
- 결제수단(카드)을 Cloudflare와 GitHub 어디에도 등록하지 않는다. 등록이 필요한 기능(예: R2)은 쓰지 않는다.
- 유료 도메인은 사지 않는다. `*.workers.dev` / `*.pages.dev` 주소를 쓴다.
- GitHub Actions는 공개 저장소에서만 무료 무제한이다. 비공개 저장소라면 결제수단이 없어야 한도 초과 때 요금 없이 막힌다.
- 한도를 넘었을 때의 동작(요금 아님):
  - Workers 하루 10만 요청 초과 → 오류 1027, UTC 00시(KST 09시)에 초기화.
  - D1 하루 읽기 500만 행 / 쓰기 10만 행 초과 → 쿼리 오류, UTC 00시 초기화. 저장 5GB 초과 → 새로 쓰기 불가.
- 그래서 화면(정적 파일)은 Workers 정적 자산이나 Pages로 내보낸다. 정적 파일 요청은 무료·무제한이라 API가 한도에 걸려도
  화면은 계속 열린다. `run_worker_first`는 쓰지 않는다(정적 파일 요청까지 Worker 한도에 묶이기 때문).
- API가 실패하면 화면은 마지막으로 받은 값을 보여 주고 "최근 갱신 실패"를 표시한다(이미 구현됨).
- 서비스 설정이나 비용 구조를 바꾸는 작업은 이 규칙에 맞는지 먼저 확인하고, 애매하면 사용자에게 묻는다.

## 확정된 규칙

- 점수: 음원 점수(고정) + 멜론 투표 10점 + 베리즈 투표 10점 + 심사 20점 = 100점.
- 심사 점수는 비공개이므로 계산에서 뺀다. 화면의 합산은 80점 만점 "잠정 순위"이며, 이 사실을 화면에 항상 표시한다.
- 사이트별 투표 점수 = 10 × (후보 득표수 ÷ 그 사이트 1위 득표수). 1위 득표수가 0이면 0점.
  - 비율(60:20:20, 멜론:베리즈 1:1)은 베리즈 공지로 확인. 사이트 안 점수 공식과 반올림 규칙은 공지에 없다(추정).
- 두 사이트 득표수의 단순 합산이나 가중평균은 만들지 않는다(실제 순위와 무관해 오해를 부른다).
- TOP10 경계(10위와 11위)가 핵심 관심사다. 관심 후보 기본값은 RESCENE.
- 날짜는 KST 00시 기준. 매일 00시 순위표를 스냅샷으로 저장해 일자별로 볼 수 있게 한다.

## 실제 투표 (2026-10-30 시작, 실제 수집으로 전환함)

- 기간: 2026-10-30 10:00 ~ 11-13 23:59:59 KST(두 사이트 공지). `site/core/config.js`의 `VOTE`(끝 11/14 00:00).
  실제 수집은 이 기간(시작 10분 전 ~ 종료 30분 뒤)에만, 백업은 시작일부터.
- 베리즈 공지: 최종 = 멜론 글로벌-K 차트 60% + 심사 20% + 투표 20%, 투표 20%는 멜론·베리즈 결과를 1:1 합산.
  베리즈 득표수는 10분마다 갱신. 하루 1표(00:00 KST 초기화).
- 멜론: 투표 화면 https://www.melon.com/mma/2026/vote/category/ 의 공개 JSON
  `https://m2.melon.com/m6/mma/2026/vote/category.json?lang=ko` → categoryId `V26005`, 후보 ID = content.id. 실시간 갱신.
  Cloudflare Worker에서 정상 수집됨(10/30 10:06~).
- 베리즈: 투표 화면 https://berriz.in/ko/vote/mma2026/ 의 공개 API
  `https://svc-api.berriz.in/service/v1/votes/mma2026/stats?languageCode=en` → data.candidates[{name, voteCount}], aggregatedAt.
  후보 ID = 이름(영문). **Cloudflare Worker에서 요청하면 HTTP 403(거절)**. 사용자 결정(10/30)으로 이전 KGMA 트래커처럼
  GitHub Actions에서 조회한다(아래 기술 구성). 조건: 10분 집계마다만, 정직한 User-Agent, 브라우저 위장 안 함,
  GitHub에서도 403이 3번 연속이면 워크플로 예약을 끄고 멈춘다(다른 곳으로 옮겨 피하지 않는다).
- 30팀과 각 사이트 ID는 config.js CANDIDATES에 있다. 예측 음원 점수가 없는 10팀은 chart: null.
- 가짜 데이터는 10/30 10:07에 D1에서 모두 삭제했다.
- **점검 중(10/30 사용자 요청):** 30팀 예측 음원 점수와 베리즈 해결책이 나올 때까지 글로벌 TOP10·베리즈 탭을 잠그고
  "점검 중" 표시, 첫 화면은 멜론 탭. 베리즈 조회도 멈췄고 상태 확인(health.py)도 베리즈를 건너뛴다.
  설정은 `site/core/config.js`의 `MAINTENANCE`(tabs, sites) 하나. 다시 열 때 목록에서 빼고 배포. 로컬 가짜 미리보기는 모두 열림.

## 음원 점수 (사용자 예측값, 공식 아님)

아래 20팀과 점수는 사용자가 정리한 **예측**이다(실제 참여 팀과 다를 수 있음). 화면에 "음원(예측)"으로 표시한다
(`RULES.chartEstimated`). 공식 음원 점수가 나오면 바꾸고 chartEstimated를 false로.

BTS 60.00, aespa 59.28, BIGBANG 54.90, IVE 54.19, SEVENTEEN 50.13, CORTIS 48.36, ILLIT 47.73,
TXT 46.70, G-Dragon 46.49, NCT WISH 46.09, RIIZE 44.66, TWICE 43.14, Hearts2Hearts 42.86,
LESSERAFIM 42.82, BOYNEXTDOOR 42.37, i-dle 42.05, Stray Kids 41.80, IU 39.80, RESCENE 39.66, BLACKPINK 38.92

음원 점수를 모르는 후보는 `chart: null` → 합산 순위 없이 "음원 점수 미확인" 구역에 투표 점수 순으로 표시한다.

## 실제 투표로 바꾸는 순서 (투표 주소를 받으면)

1. 두 사이트의 실제 응답을 확인하고 `worker/adapters/melon.js`, `berriz.js`를 채운다(SAMPLE·NEEDS_PREV false).
   이전 트래커의 조회 방식 참고(아래 참고 링크). 요청 빈도는 1분 1회, 약관 준수.
2. `site/core/config.js` CANDIDATES를 공개된 30팀으로 바꾸고 siteIds를 사이트 응답의 ID로 직접 채운다.
   예측 음원 점수가 있는 팀만 chart 값, 나머지 null. 관심 후보(PIN_DEFAULT)가 명단에 있는지 확인.
3. 가짜 데이터 삭제(사용자가 요청함): 원격 D1에서 `DELETE FROM obs; DELETE FROM blob WHERE k <> 'm:usage';`
4. 배포 후 첫 수집이 정상인지 확인(이름 매칭 누락, 0표 후보, 시각차).

## 화면 구성 (3개 탭)

초안: `draft/tracker-draft.html` (예시 데이터로 동작하는 단일 HTML. 디자인과 기능의 기준. 실제 코드는 `site/`)

1. 글로벌 TOP10 순위 (첫 화면)
   - 요약 카드: 1위, TOP10 컷(10·11위 점수차), 관심 후보
   - 순위표: 음원·멜론·베리즈 점수, 합산, 순위 변동(오늘 00시 대비), 앞 순위와 점수차,
     역전에 필요한 표(멜론만/베리즈만, 다른 후보 표가 그대로라는 가정)
   - 10위 아래 컷 라인, 날짜 선택(실시간 / 각 날짜 00시 마감)
   - 점수 추이: 합산 점수, 1·2위 차, 10·11위 차
2. 멜론 투표, 3. 베리즈 투표 (기존 트래커 기능 유지)
   - 1·2위 카드와 표차, 전체 후보 표(득표수·점유율·앞 순위와 차·1시간 증가·사이트 점수)
   - 득표수/득표율 추이(6시간/24시간/전체)
   - 표차 분석: 두 후보 선택, 5분·30분·1시간·일봉 캔들(빨강 확대, 파랑 축소), 1·4·24시간 변화
   - 시간대별 증가량, 일일 득표량, 날짜별 마감 기록
- 공통: 상단 수집 상태(사이트별 최근 수집 시각, 사이트 간 시각차, 투표 마감까지 남은 시간), 요약 복사, 일반/다크 모드
- 휴대폰(폭 640px 이하, 2026-10-29 사용자 피드백 반영):
  - 순위는 표 대신 한 줄 목록(순위·변동·이름·합산·앞 순위와 차, 작은 글씨로 음원+멜론+베리즈). 누르면 득표수·역전 필요 표.
  - 시간대별 증가량·날짜별 마감 기록은 1·2위 + 관심 후보만, 큰 숫자는 만 단위.
- 시간대별 증가량·날짜별 마감 기록 표는 어떤 화면 폭에서도 좌우 스크롤이 없다: 패널 전체 폭을 쓰고(`.heat.fit`),
  보여 주는 팀 수를 폭에 맞춘다(넓음 상위 6팀, 900px 이하 4팀, 640px 이하 2팀 + 관심 후보). 긴 설명은 칸 안 둘째 줄.
  - 사이트 전체 현황은 접지 않고 바로 보인다. 휴대폰은 한 줄 목록(순위·이름/점수·1시간 증가·득표수/앞 순위와 차).
  - 상단 탭 고정 안 함. 상태줄은 남은 초만 바꿔 화면이 들썩이지 않게. 요약 카드는 2열로 작게.
  - 후보 버튼은 상위 12팀 + 선택 팀만, "전체 N팀 보기"로 펼침.
  - 제목 아래 부제목은 따로 한 줄. TOP10 컷 카드는 맨 위 전체 폭(10위·11위를 한 줄씩: 순위·이름·점수), 1위·관심 후보는 아래 2열.
- 맨 위로 버튼(오른쪽 아래, 반 화면 이상 내려가면 표시, 강조색). 부드러운 스크롤이 0.9초 안에 안 끝나면 바로 이동.
- 글자 두께: 굵기는 600까지, 숫자 폰트는 500까지. 없는 굵기를 브라우저가 흉내 내지 않게 font-synthesis 끔.
- 다크 모드(2026-10-29 사용자 요청): 이전 트래커(https://woniwoniwoniwoni.github.io/mma-vote-tracker/) 다크 모드 색을 따른다.
  바탕 #100e19, 패널 #191725, 글자 #f5f0f6, 보조 글자 #aaa3b8, 강조 분홍 #ff7594(눌린 버튼·배지·TOP10 선),
  멜론 민트 #83d9b5, 베리즈 호박색 #ffc176, 차트 선은 라임·분홍·청록·민트·호박·파랑·자홍(--c1~--c8),
  1위 카드는 #4a243d→#211a31 그라데이션 + #97445f 테두리(.card.first). 관심 후보 줄 #41223c.
  색은 모두 style.css 맨 위 토큰에서만 바꾼다(두 다크 블록을 같이 고칠 것). 일반 모드는 그대로.
- 이미지 공유(`site/share.js`, 2026-10-29): 패널의 "이미지 공유" 버튼 → 공유창(이미지 복사, PNG 다운로드,
  휴대폰 공유하기, 게시판용 HTML 복사). 대상: 글로벌 순위표·점수 추이, 사이트별 전체 현황·득표 추이·표차 캔들.
  - 순위표·현황표 PNG는 데이터로 캔버스에 직접 그린다(현재 테마 색). 차트 PNG는 화면 SVG를 그대로 옮긴다.
  - 게시판용 HTML은 표와 인라인 스타일만(밝은 색 고정, 이미지 없음), 65,535자 이하. 차트는 이미지로만.
  - 화면에서 고른 날짜·후보·봉 간격·관심 후보 강조가 그대로 반영된다.

## 아직 넣지 않은 것 (다음 작업)

- 이미지 공유 확장: 시간대별 증가량·일일 득표량·마감 기록 표는 아직 공유 버튼이 없다.
- 글로벌 TOP10 탭 다시 열기: 사용자가 30팀 예측 음원 점수를 주면 config.js chart 값을 채우고 MAINTENANCE.tabs를 []로.
- 12시간 표차 예측은 넣지 않는다(점수 구조가 달라 검증이 안 됨).

## 기술 구성 (정한 방향)

GitHub Actions 커밋 방식은 실행 지연이 있어 쓰지 않는다. Cloudflare 무료 플랜을 쓴다.

- 수집(2026-10-30 변경):
  - 멜론: Cloudflare Workers Cron 1분마다, 한 번 실행 안에서 0·20·40초에 세 번 조회(원본이 실시간). 실행당 CPU 1~5ms 확인.
    0초 값만 h:/d: 조각(그래프·기록은 1분 간격 유지), 20·40초 값은 최신값 조각 `l:melon`에만(화면 응답 크기 유지).
  - 베리즈: Cloudflare에서 403이라 GitHub Actions `.github/workflows/berriz.yml` + `scripts/berriz_collect.py`.
    한 실행이 최대 5시간 40분 동안 10분 경계 +60초에 읽고, 새 집계가 아니면 30초 간격으로 +6분까지 재확인.
    새 집계면 원본 응답을 POST /api/ingest/berriz(Bearer INGEST_TOKEN)로 보내고 Worker가 `berriz.parse`로 저장(같은 집계는 무시).
    예약 7,22,37,52분은 다음 실행 대기용(concurrency 그룹 하나). 비밀값이 없으면 조용히 끝낸다(실패 메일 방지).
  - 베리즈 관측은 집계 시각(sourceAt)을 기준 분으로 쓴다(`history.js slotOf`). 00:00 집계는 전날 마감값.
  - 사이트별 기준은 config.js `COLLECT`(오래된 값: 멜론 3분·베리즈 20분, 빈 구간: 10분·25분, 합산 보류 시각차 25분).
  - 화면 갱신(10/30 변경): 최소 20초. 사이 갱신은 /api/now(사이트별 최신 한 줄, 약 1KB, 캐시 10초)만 받고,
    그래프용 /api/latest(2시간치)는 5분마다만. 접속이 많으면 서버가 간격을 20초~10분 사이로 늘린다(아래 3번).
  KST 00시 마감값은 매분 수집의 00:00 관측으로 남으므로 스냅샷용 Cron은 따로 두지 않았다(2026-10-29 변경).
- 저장: Cloudflare D1. 관측 1회 = 1행(후보 전체를 JSON으로 묶음). 후보별로 행을 나누면
  무료 쓰기 한도(하루 10만 행)를 넘는다. KV는 무료 쓰기가 하루 1,000회라 수집에 쓰지 않는다.
- 데이터 형식: `{source, observedAt, sourceAt|null, totalVotes, candidates:{id: votes}}`.
  사이트 간 후보 매칭은 이름·순위로 추정하지 않고 설정 파일에 ID를 직접 적는다.
- 한 사이트 수집이 실패하면 마지막 정상값을 쓰고 "N분 전 값"으로 표시한다.
  두 사이트 관측 시각 차이가 허용치를 넘으면 합산 점수를 보류한다.
- 화면: 같은 Worker의 정적 자산(site/)으로 내보낸다(무료·무제한, API와 같은 주소라 CORS 불필요).
- 점수 계산 위치(2026-10-29 변경): 원래 "API에서 한 번만 계산"이었으나, 무료 플랜 CPU 10ms와 D1 읽기 한도 때문에
  Worker는 계산하지 않고 관측 조각만 내려주며, 계산은 브라우저가 `site/core/api.js`로 한다.
  계산 코드는 여전히 한 벌이고, 가짜 모드와 실제 모드가 같은 코드를 쓴다.
- 요청 수(2026-10-29 적용): Workers 무료 플랜은 계정 전체 하루 10만 요청(UTC 00시 = KST 09시 초기화).
  workers.dev 주소에서는 Cache API가 동작하지 않으므로 캐시에 기대지 않는다. 세 가지로 아낀다.
  1. 첫 접속 1회(/api/init), 이후 갱신마다 1회(/api/latest).
  2. 자리 비움: 15분 동안 조작이 없거나 탭이 백그라운드면 갱신을 멈춘다. 움직이면 바로 갱신(`?idle=초`로 시험).
  3. 서버가 갱신 간격을 정함: Cron이 5분마다 Cloudflare GraphQL 사용량(workersInvocationsAdaptive, 15분 묶음 1회 조회)으로
     오늘 쓴 양과 최근 속도를 보고, 남은 한도(10% 여유 제외)를 초기화까지 고르게 쓰도록 20~600초를 정해 `m:usage`에 저장.
     API 응답의 refreshSec 를 화면이 따른다. 통계 API는 조회 제한이 있어("Rate limiter budget depleted") 조회를 아낀다.
     비밀값 CF_API_TOKEN·CF_ACCOUNT_ID 가 없으면 이 기능만 꺼지고 60초로 동작한다.
- 백업(2026-10-29 적용): GitHub Actions `.github/workflows/backup.yml`이 매일 00:30 KST에 `scripts/backup.py`로
  끝난 KST 날짜의 obs 원본을 `backup/obs-YYYY-MM-DD.ndjson.gz`로 커밋한다(D1 REST 조회, D1 읽기 권한).
  공개 저장소라 Actions 무료. 예약이 늦어도 백업에는 문제없고, 빠진 날은 다음 실행에서 채운다.
- 지난 날짜 데이터(2026-10-29 점검 후 변경): 첫 접속(/api/init)은 오늘 + 최근 7시간 + 지난 날짜 목록만 준다.
  지난 날짜는 화면이 `/history/YYYY-MM-DD.json`으로 하루씩 받는다. 같은 백업 작업이 이 파일을 `site/history/`에 만들어
  커밋하고 `wrangler deploy`로 정적 파일로 올린다(CF_DEPLOY_TOKEN 이 있을 때). 파일이 없으면 Worker가 D1 'd:' 조각으로
  대신 답한다. 그래서 응답 크기가 투표 기간 길이와 무관하게 하루치 이하로 묶인다(CPU 10ms 한도 대비).
  주의: 로컬에서 배포할 때는 먼저 `git pull`(정적 날짜 파일이 빠진 채 배포되면 Worker가 대신 답하긴 하지만 요청을 쓴다).
- 수집 이상 알림: `.github/workflows/health.yml`이 30분마다(투표 기간만) `scripts/health.py`로 /api/latest를 확인해
  API 오류·15분 넘은 관측·가짜 데이터면 이슈를 열고 저장소 주인을 언급(이메일 알림), 정상이면 닫는다(라벨 collect-alert).
- 아이콘(favicon.svg/ico, apple-touch-icon.png)과 robots.txt를 정적 파일로 둬서 브라우저 자동 요청이 Worker 한도를 안 쓴다.
  링크 미리보기: index.html의 og 태그 + `site/og.png`(1200×630). 그림은 Edge 헤드리스 스크린샷으로 만들었다.
- 홈 화면 앱(2026-10-30): `site/manifest.webmanifest`(standalone, 아이콘 192·512·maskable 512) + iOS용 meta.
  앱스토어 앱은 등록비가 들어 하지 않는다. 홈 화면 앱으로 열면 휴대폰에서 body 위에 safe-area 여백을 둔다.
- 비밀값(파일에 적지 않음): Cloudflare API 토큰 하나(Account Analytics 읽기 + D1 읽기)를
  Worker 비밀값과 GitHub 저장소 비밀값에 CF_API_TOKEN 으로, 계정 ID를 CF_ACCOUNT_ID 로 각각 넣는다.
  토큰 값은 사용자가 직접 입력한다(Claude가 토큰을 받거나 입력하지 않는다).
  배포용 토큰은 따로: GitHub 저장소 비밀값 CF_DEPLOY_TOKEN("Edit Cloudflare Workers" 템플릿 + D1 읽기). 없으면 정적 날짜 파일만 안 올라간다.
- 투표 주소 공개 전: 사이트별 "어댑터"(원본 응답을 공통 형식으로 바꾸는 부분)는 가짜 데이터로
  두고 나머지를 완성한다. 주소가 공개되면 실제 응답을 확인해 어댑터만 채운다.
- 원본 사이트의 약관과 요청 빈도를 지킨다(과도한 호출 금지).

## 현재 상태 (2026-10-29, 1~4번 작업 완료)

- 운영 주소: https://mma-global-tracker.happyapple.workers.dev (10/30부터 실제 수집. 멜론 20초, 베리즈 GitHub 10분(10:30 집계부터) 정상. 글로벌 탭만 점검 중)
- Cloudflare 무료 플랜. D1 `mma-tracker`(APAC, id는 wrangler.jsonc). wrangler 로그인 완료.
- 개인정보: 이 저장소는 공개다. 사용자의 이메일, 이메일에서 나온 아이디, 계정 ID를 파일·커밋에 적지 않는다.
  workers.dev 하위 도메인은 원래 이메일 아이디였어서 사용자가 대시보드에서 happyapple로 바꿨다(2026-10-29).
- 저장소: https://github.com/WONIWONIWONIWONI/mma-global-tracker (공개, main 브랜치)
- 방문 통계: Cloudflare Web Analytics(무료, 쿠키 없음). `site/index.html` <head>의 비콘 스크립트(공개 토큰).
  방문 기록은 cloudflareinsights.com으로 가므로 Worker 요청 한도를 쓰지 않는다. 대시보드 → 관찰 가능성 → Web Analytics.

## 파일 구조

- `site/` 정적 화면(배포 시 그대로 공개)
  - `app.js` 화면 그리기, `charts.js` 차트, `format.js` 표시 형식, `settings.js` 데이터 출처·갱신 간격, `share.js` 이미지 공유
  - `remote.js` /api에서 관측을 받아 모으고 `core/api.js`로 계산, 서버가 정한 갱신 간격(refreshSec) 보관
  - `core/` 계산 부분(브라우저·Worker 공용, 외부 라이브러리 없음)
    - `config.js` 후보(id·이름·음원 점수·사이트별 ID), 점수 규칙, 수집 기준(오래된 값 3분, 합산 보류 5분, 빈 구간 10분)
    - `scoring.js` 사이트 점수, 합산 순위, 역전 필요 표 / `history.js` 관측 → 화면용 시계열(최근 6시간 1분, 48시간 5분, 그 이전 15분)
    - `api.js` `buildPayload(사이트별 관측, now)` → 화면 데이터(실시간 순위, 00시 마감 순위, 점수 추이, 사이트별 시계열)
    - `fakeSource.js` 가짜 데이터(브라우저용 전체 생성 + Worker용 `fakeNext`), `mockApi.js` 브라우저 안 가짜 API
- `worker/index.js` 1분 수집(Cron), 5분마다 사용량 확인, /api(init, latest). 저장 구조 설명은 파일 머리말.
  `worker/adapters/` 사이트별 어댑터(지금은 가짜), `worker/schema.sql` D1 표
- `scripts/seed-local.mjs` 로컬 D1에 2.5일치 가짜 관측 채우기(원격은 건드리지 않음)
- `scripts/backup.py` D1 → backup/ 날짜별 백업(`--dry-run` 미리보기), `backup/` 백업 파일과 형식 설명
- `wrangler.jsonc` Worker 설정, `package.json` 명령(dev, deploy, db:init:local/remote)

## 실행 방법

- 가짜 데이터 미리보기: `미리보기.bat` 또는 `python -m http.server 8000 --directory site` → http://localhost:8000/
  (포트 8000이나 `?mock`이면 브라우저 안 가짜 API를 쓴다)
- Worker까지 로컬 실행: `npm run db:init:local`, `node scripts/seed-local.mjs`, `npm run dev` → http://localhost:8787/
  수집 1회 실행: http://localhost:8787/__scheduled?cron=*+*+*+*+*
- 배포: `npx wrangler deploy` (Claude 앱 안 PowerShell에서는 node 경로를 못 찾을 수 있어 PATH를 다시 읽거나
  `node node_modules/wrangler/bin/wrangler.js deploy`로 실행)
- D1 문장은 100KB 제한이 있다. 큰 데이터는 여러 문장으로 나눠 이어 붙인다.
- npm 12는 설치 스크립트를 막는다. workerd, esbuild는 `npm install-scripts approve`로 허용해 두었다.
- 이 컴퓨터에 git, Node.js(LTS), GitHub CLI 설치됨(winget). 새 PowerShell 창이 아니면 PATH를 다시 읽어야 한다.
- 커밋 작성자 이메일은 GitHub noreply 주소(338686815+WONIWONIWONIWONI@users.noreply.github.com)를 쓴다.

## 참고

- 이전 트래커(코드 참고용, 그대로 복사하지 않음): https://github.com/WONIWONIWONIWONI/mma-vote-tracker
  - 멜론 공개 집계 API 조회 방식, 날짜 경계 처리, 누락값을 0으로 채우지 않는 원칙은 참고할 만하다.
  - 예측 모델, legacy 폴더 같은 과한 구조는 가져오지 않는다.
- 이전 KGMA 베리즈 트래커: https://github.com/WONIWONIWONIWONI/kgma-vote-tracker (베리즈 조회 방식 참고)

## 첫 작업 순서 제안

1. 이 폴더를 git 저장소로 만들고 GitHub에 새 저장소로 올린다(사용자 확인 후).
2. 초안 HTML을 화면(`site/`)과 계산 모듈로 나누고, 가짜 데이터 API로 동작하게 한다.
3. Cloudflare 계정 로그인(사용자가 브라우저에서 승인) 후 Worker·D1·Cron을 만들고 가짜 어댑터로 배포한다.
4. 이미지 공유 기능을 추가한다.
5. 투표 주소가 공개되면 어댑터를 실제 응답에 맞춘다.
