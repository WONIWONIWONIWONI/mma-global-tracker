# MMA 2026 글로벌 TOP10 트래커

멜론과 베리즈에서 동시에 진행되는 MMA 2026 글로벌 TOP10 투표를 실시간으로 수집하고,
투표 점수(나중에 음원 점수까지)를 합쳐 순위를 보여주는 비공식 트래커.

## 작업 방식 (사용자에 대해)

- 사용자는 코딩을 모른다. 설명은 쉬운 한국어로, 전문 용어는 풀어서 쓴다.
- 명령 실행, 배포, 커밋은 Claude가 직접 하고, 무엇을 했는지 한두 문장으로 알린다.
- 되돌리기 어려운 작업(데이터 삭제, 공개 저장소 변경, 유료 요금제 관련)은 하기 전에 먼저 묻는다.
- 사용자가 직접 해야 하는 일(로그인, 브라우저 승인, 비밀값 입력 등)은 단계별로 짧게 안내한다.

## 최우선 규칙: 추가 결제가 절대 생기지 않게 한다

사용량이 한도를 넘더라도 요금이 청구되면 안 된다. 서비스가 잠시 멈추는 것은 괜찮고, 요금 청구는 안 된다.
(2026-10-29 공식 문서로 확인: Cloudflare 무료 플랜과 결제수단 없는 GitHub는 한도를 넘으면 오류가 나거나 막힐 뿐이고 요금이 청구되지 않는다)

- Cloudflare는 무료 플랜만 쓴다. Workers Paid 등 유료 업그레이드는 하지 않는다.
- 결제수단(카드)을 Cloudflare와 GitHub 어디에도 등록하지 않는다. 등록이 필요한 기능(예: R2)은 쓰지 않는다.
- 유료 도메인은 사지 않는다. `*.workers.dev` 주소를 쓴다.
- GitHub Actions는 공개 저장소에서만 무료 무제한이다(이 저장소는 공개).
- 한도를 넘었을 때의 동작(요금 아님):
  - Workers 하루 10만 요청(계정 전체) 초과 → 오류 1027, UTC 00시(KST 09시)에 초기화.
    Cron 실행도 같은 한도에 들어간다(넘으면 멜론 수집도 멈출 수 있음. 아래 GitHub 보조 수집이 기록을 지킨다).
  - D1 하루 읽기 500만 행 / 쓰기 10만 행 초과 → 쿼리 오류, UTC 00시 초기화. 저장 5GB 초과 → 새로 쓰기 불가.
- 화면(정적 파일)은 Workers 정적 자산으로 내보낸다. 정적 파일 요청은 무료·무제한이라 API가 한도에 걸려도 화면은 열린다.
  `run_worker_first`는 쓰지 않는다(정적 파일 요청까지 Worker 한도에 묶이기 때문).
- API가 실패하면 화면은 마지막으로 받은 값을 보여 주고 "최근 갱신 실패"를 표시한다.
- 서비스 설정이나 비용 구조를 바꾸는 작업은 이 규칙에 맞는지 먼저 확인하고, 애매하면 사용자에게 묻는다.

## 투표와 점수 규칙

- 기간: 2026-10-30 10:00 ~ 11-13 23:59:59 KST(두 사이트 공지). `site/core/config.js`의 `VOTE`(끝 11/14 00:00).
  수집은 이 기간(시작 10분 전 ~ 종료 30분 뒤)에만, 백업은 시작일부터.
- 최종 = 멜론 글로벌-K 차트(음원) 60% + 심사 20% + 투표 20%. 투표 20%는 멜론·베리즈 결과를 1:1 합산(베리즈 공지,
  멜론 투표 화면 문구로 확인). 심사 점수는 비공개라 계산에서 뺀다.
- 사이트별 투표 점수 = 10 × (후보 득표수 ÷ 그 사이트 1위 득표수). 1위 득표수가 0이면 0점.
  사이트 안 환산 방식은 공지에 없지만 사용자가 이 방식이 맞다고 판단함(10/30). 바꾸지 않는다. 반올림은 하지 않는다.
- 두 사이트 득표수의 단순 합산이나 가중평균은 만들지 않는다(실제 순위와 무관해 오해를 부른다).
- **지금 화면(10/30 오후~): 예측 음원 + 멜론 + 베리즈 80점 만점 잠정 순위**(`RULES.useChart = true`).
  음원 점수는 사용자가 준 예측표(@kowartermelon, 10/14 기준 30팀)의 값이고 공식 값이 아니라 "음원(예측)"으로 표시
  (`RULES.chartEstimated`). 예측표의 NCT 127(25.25)·Red Velvet(25.00)은 실제 후보가 아니고, 실제 후보 ROSÉ·YENA는
  예측표에 없어 chart: null → "음원 점수 미확인"으로 합산 순위 없이 아래에 따로 표시.
  공식 음원 점수가 나오면 chart 값을 바꾸고 chartEstimated를 false로.
- `useChart = false`로 바꾸면 투표 점수만 합산한 20점 만점 순위(30팀 모두 순위, 음원 열 없음, "투표 점수 기준" 안내).
  10/30 오전에는 예측 점수가 없어 이렇게 운영했다.
- TOP10 경계(10위와 11위)가 핵심 관심사다. 관심 후보 기본값은 RESCENE.
- 날짜는 KST 00시 기준. 매일 00시 순위를 마감 기록으로 날짜별로 볼 수 있다.
- 베리즈: 득표수는 10분마다(00·10·20…분) 집계, 하루 1표(00:00 KST 초기화), 비정상 투표는 집계에서 빠질 수 있다
  (표가 줄면 화면에 * 표시와 "오류 아님" 설명).

## 원본 사이트

- 멜론: 투표 화면 https://www.melon.com/mma/2026/vote/category/ 의 공개 JSON
  `https://m2.melon.com/m6/mma/2026/vote/category.json?lang=ko` → categoryId `V26005`, 후보 ID = content.id. 실시간 갱신.
- 베리즈: 투표 화면 https://berriz.in/ko/vote/mma2026/ 의 공개 API
  `https://svc-api.berriz.in/service/v1/votes/mma2026/stats?languageCode=en` → data.candidates[{name, voteCount}], aggregatedAt.
  후보 ID = 이름(영문). **Cloudflare에서 요청하면 HTTP 403(거절)**이라 사용자 결정(10/30)으로 GitHub Actions에서 조회한다.
  조건: 10분 집계마다만, 정직한 User-Agent, 브라우저 위장 안 함, 403이 3번 연속이면 그 사이트 조회를 멈춘다
  (다른 곳으로 옮겨 피하지 않는다).
- 30팀과 사이트별 ID는 config.js `CANDIDATES`. 사이트가 이름·ID를 바꾸면 그 팀 값이 빠지므로
  화면 상태줄 경고 + 상태 확인 메일로 알린다.
- 요청 빈도: 멜론 Cloudflare 분당 3회 + GitHub 분당 1회, 베리즈 10분에 1~3회. 원본 약관과 빈도를 지킨다.

## 화면 구성 (3개 탭)

1. 글로벌 TOP10 순위 (첫 화면)
   - 요약 카드: TOP10 컷(10·11위 점수차), 1위, 관심 후보
   - 순위표: (음원·)멜론·베리즈 점수, 합산, 순위 변동(오늘 00시 대비), 앞 순위와 점수차(0.01 미만은 소수 셋째 자리, 같으면 "동점"),
     역전에 필요한 표(멜론만/베리즈만, 다른 후보 표가 그대로라는 가정). 한 사이트 값이 빠진 팀은 "값 없음" 표시
   - 10위 아래 컷 라인, 날짜 선택(실시간 / 각 날짜 00시 마감), 점수 추이(합산 점수, 1·2위 차, 10·11위 차)
2. 멜론 투표, 3. 베리즈 투표
   - 1·2위 카드와 표차, 전체 후보 표(득표수·점유율·앞 순위와 차·1시간 증가·사이트 점수)
     (직전 증가: 멜론은 1분, 베리즈는 직전 집계)
   - 득표수/득표율 추이(6시간/24시간/전체), 표차 분석(두 후보, 5분·30분·1시간·일봉 캔들, 1·4·24시간 변화)
   - 시간대별 증가량, 일일 득표량, 날짜별 마감 기록
- 공통: 상단 수집 상태(사이트별 최근 수집 시각과 베리즈 집계 시각, 사이트 간 시각차, 마감까지 남은 시간, 빠진 팀 경고),
  요약 복사, 일반/다크 모드, 맨 위로 버튼(반 화면 이상 내려가면, 부드러운 스크롤이 0.9초 안에 안 끝나면 바로 이동)
- 점검 중 표시: config.js `MAINTENANCE`(tabs: 잠글 탭, sites: 상태줄 "점검 중" + 상태 확인 제외). 지금은 둘 다 비어 있음.
- 휴대폰(폭 640px 이하):
  - 순위는 표 대신 한 줄 목록(순위·변동·이름·합산·앞 순위와 차, 작은 글씨로 점수 구성). 누르면 득표수·역전 필요 표.
  - 사이트 전체 현황도 한 줄 목록, 접지 않고 바로 보임.
  - 시간대별 증가량·날짜별 마감 기록은 좌우 스크롤 없음(`.heat.fit`): 넓음 6팀, 900px 이하 4팀, 640px 이하 2팀 + 관심 후보.
  - 상단 탭 고정 안 함. 상태줄은 남은 초만 바꿔 화면이 들썩이지 않게. 후보 버튼은 상위 12팀 + 선택 팀, "전체 N팀 보기".
  - 제목 아래 부제목은 따로 한 줄. TOP10 컷 카드는 맨 위 전체 폭, 1위·관심 후보는 아래 2열.
- 글자 두께: 굵기 600까지, 숫자 폰트 500까지, font-synthesis 끔.
- 다크 모드: 이전 트래커(https://woniwoniwoniwoni.github.io/mma-vote-tracker/) 색. 바탕 #100e19, 패널 #191725,
  글자 #f5f0f6, 보조 #aaa3b8, 강조 분홍 #ff7594, 멜론 민트 #83d9b5, 베리즈 호박색 #ffc176, 차트 선 --c1~--c8,
  1위 카드 #4a243d→#211a31 + #97445f 테두리, 관심 후보 줄 #41223c. 색은 style.css 맨 위 토큰에서만(두 다크 블록 같이).
- 이미지 공유(`site/share.js`): 이미지 복사, PNG 다운로드, 휴대폰 공유, 게시판용 HTML(인라인 스타일, 65,535자 이하).
  대상: 글로벌 순위표·점수 추이, 사이트별 전체 현황·득표 추이·표차 캔들. 화면에서 고른 날짜·후보·관심 후보가 반영된다.
- 홈 화면 앱: `site/manifest.webmanifest` + iOS meta(앱스토어 등록 안 함). 링크 미리보기: og 태그 + `site/og.png`.

## 수집과 저장

- 멜론(주): Cloudflare Workers Cron 1분마다, 한 번 실행 안에서 0·20·40초에 조회. 실행당 CPU 1~5ms.
  0초 값만 h:/d: 조각(그래프·기록은 1분 간격), 20·40초 값은 최신값 조각 `l:melon`에만.
- GitHub 수집 `.github/workflows/berriz.yml` + `scripts/github_collect.py`(비밀값 INGEST_TOKEN, Worker와 같은 값):
  - 베리즈(주): 10분 경계 +60초에 읽고, 새 집계가 아니면 30초 간격으로 +6분까지 재확인 → POST /api/ingest/berriz.
    Worker가 `berriz.parse`로 저장(같은 집계는 무시, 관측 시각은 GitHub이 읽은 시각 X-Observed-At).
  - 멜론(보조): 1분마다 읽어 5분마다 POST /api/ingest/melon(15개씩). Worker는 이미 있는 분은 버리고 빠진 분만 채운다
    (Cloudflare 한도 초과·Cron 누락 대비).
  - 보내기 실패분은 보관했다가 5분마다 재전송, 실행이 끝날 때 남으면 `backup/pending.json`으로 저장소에 남기고 다음 실행이 이어서 보낸다.
  - 사이트가 403을 3번 연속 주면 `scripts/blocked-<사이트>` 파일을 남기고 그 사이트 조회를 멈춘다(파일을 지우면 재개).
  - 한 실행 최대 5시간 40분. 예약 7,22,37,52분은 다음 실행 대기용(concurrency 그룹 하나). 비밀값이 없으면 조용히 끝낸다.
  - 이미 대기 중인 실행은 예약된 시점의 코드로 돈다. 수집 코드를 바꾸면 실행 중·대기 중 실행을 취소하고 새로 시작(gh run cancel, gh workflow run).
  - GitHub이 장시간 Actions 사용을 문제 삼을 위험은 알고 있음. 사용자 결정(10/30): 문제가 생기면 그때 수정.
- 시각 기준(`history.js slotOf`): 베리즈는 집계 시각(sourceAt), 멜론은 관측 시각을 분 단위 내림(정각 5초 전까지는 다음 분).
  00:00 값은 전날 마감값. 사이트별 기준은 config.js `COLLECT`(오래된 값 멜론 3분·베리즈 20분, 빈 구간 10분·25분,
  합산 보류 시각차 25분).
- 저장: Cloudflare D1. obs(관측 원본, 1회 1행, 후보 전체 JSON), blob(화면용 조각: h: 시간, d: 날짜, l: 최신값,
  m:usage 오늘 사용량, m:refresh 갱신 간격, c:<분> 요청 표본 집계). 자세한 설명은 `worker/index.js` 머리말.
  후보별로 행을 나누면 무료 쓰기 한도를 넘는다. KV는 무료 쓰기가 하루 1,000회라 쓰지 않는다.
- 데이터 형식: `{source, observedAt, sourceAt|null, totalVotes, candidates:{id: votes}}`. 누락값은 0으로 채우지 않는다.
- 점수 계산은 브라우저가 `site/core/api.js`로 한다(Worker CPU 10ms 한도 때문에 Worker는 관측 조각만 내려줌).

## 요청 한도 관리

- 화면 갱신: 최소 20초. 사이 갱신은 /api/now(사이트별 최신 한 줄, 약 1KB, 캐시 10초), 그래프용 /api/latest(2시간치)는
  5분마다, 첫 접속은 /api/init(오늘 + 최근 7시간 + 지난 날짜 목록), 지난 날짜는 /history/날짜.json(정적 파일).
- 자리 비움: 15분 동안 조작이 없거나 탭이 백그라운드면 갱신을 멈춘다(`?idle=초`로 시험).
- 서버가 갱신 간격(20~600초)을 정한다(10/30 개선):
  - API 요청 8번에 1번꼴로 그 분의 칸(c:<분>)에 8을 더해 지금 속도를 잰다(쓰기 한도 절약 표본 집계).
  - 매분 Cron(`adjustRefresh`)이 최근 3분 속도(직전 1분이 더 크면 그 값)와 오늘 쓴 양(5분마다 GraphQL 통계 `m:usage`
    + 그 뒤 어림)으로, 남은 한도(10% 여유, 고정 요청 분당 3 제외)를 초기화까지 고르게 쓰는 가장 짧은 간격을 `m:refresh`에 둔다.
  - 늘릴 때는 바로, 줄일 때는 1분에 절반까지만(출렁임 방지). 1~2분 안에 반응(전에는 15~20분).
  - 화면은 API 응답의 refreshSec 를 따른다. m:refresh 가 10분 넘게 안 바뀌면 120초.
- 하루 시청 약 550시간(동시 평균 20여 명)까지 20초 유지 어림. 그 이상은 자동으로 간격이 늘어난다.
- workers.dev 주소에서는 Cache API가 동작하지 않는다.

## 백업·알림·시험

- 백업 `.github/workflows/backup.yml`(매일 00:30 KST): `scripts/backup.py`가 끝난 날짜의 obs 원본을
  `backup/obs-YYYY-MM-DD.ndjson.gz`로, 화면용 `site/history/YYYY-MM-DD.json`(시각순 정렬)을 만들어 커밋하고
  `wrangler deploy`로 올린다(CF_DEPLOY_TOKEN). 끝난 지 3일 이내 날짜는 매번 다시 만든다(늦게 채워진 관측 반영).
  주의: 로컬에서 배포할 때는 먼저 `git pull`(밤마다 백업 작업이 날짜 파일을 커밋한다).
- 수집 이상 알림 `.github/workflows/health.yml`(30분마다, 투표 기간만): `scripts/health.py`가 /api/latest를 확인해
  API 오류, 오래된 관측(멜론 15분·베리즈 35분), 최신 관측에서 빠진 팀, 가짜 데이터면 이슈를 열고 저장소 주인을 언급
  (이메일 알림), 정상이면 닫는다(라벨 collect-alert).
- 자동 시험 `tests/`(Node 기본 시험 도구, 설치 없음): 점수·순위(투표만/음원 포함), 시각 기준과 00시 마감, 빈 구간,
  합산 보류, 빠진 팀, 점수 차 표시, Worker 보조 수집 중복 제외·베리즈 중복 제외·비밀값 확인·갱신 간격 계산(가짜 D1).
  `npm test`. `npm run deploy`는 시험이 통과해야 배포한다. GitHub에 올리면 `.github/workflows/test.yml`도 돈다.
  Claude 앱 PowerShell에서는 `node --test "tests/*.test.js"` 후 `node node_modules/wrangler/bin/wrangler.js deploy`.
  (Node 22는 `node --test tests/`처럼 폴더를 주면 실패한다. 파일 패턴으로 준다)

## 비밀값 (파일에 적지 않음)

- CF_API_TOKEN(Account Analytics 읽기 + D1 읽기), CF_ACCOUNT_ID: Worker 비밀값과 GitHub 저장소 비밀값 양쪽.
- CF_DEPLOY_TOKEN("Edit Cloudflare Workers" 템플릿 + D1 읽기): GitHub 저장소 비밀값(밤 백업의 정적 파일 배포).
- INGEST_TOKEN(사용자가 만든 긴 무작위 글자): Worker 비밀값과 GitHub 저장소 비밀값 양쪽(GitHub 수집 → Worker 저장).
- 토큰 값은 사용자가 직접 입력한다(Claude가 받거나 입력하지 않는다). 로컬 시험용 값은 `.dev.vars`(커밋 안 됨).

## 현재 상태 (2026-10-30)

- 운영 주소: https://mma-global-tracker.happyapple.workers.dev
  멜론 20초(Cloudflare) + 1분 보조(GitHub), 베리즈 10분(GitHub, 10:30 집계부터). 세 탭 모두 열림, 글로벌은 예측 음원 포함 80점.
- 가짜 데이터는 10/30 10:07에 D1에서 모두 삭제했다.
- Cloudflare 무료 플랜. D1 `mma-tracker`(APAC, id는 wrangler.jsonc). wrangler 로그인 완료.
- 저장소: https://github.com/WONIWONIWONIWONI/mma-global-tracker (공개, main 브랜치)
- 개인정보: 공개 저장소다. 사용자의 이메일, 이메일에서 나온 아이디, 계정 ID를 파일·커밋에 적지 않는다.
  workers.dev 하위 도메인은 원래 이메일 아이디였어서 사용자가 happyapple로 바꿨다(10/29).
- 방문 통계: Cloudflare Web Analytics(무료, 쿠키 없음, 운영 주소에서만 로드). 대시보드 → 관찰 가능성 → Web Analytics.

## 다음 작업 후보

- ROSÉ·YENA 음원 점수(예측표에 없음)를 받으면 넣기. 공식 음원 점수가 나오면 교체.
- 이미지 공유 확장: 시간대별 증가량·일일 득표량·마감 기록 표는 아직 공유 버튼이 없다.
- 12시간 표차 예측은 넣지 않는다(점수 구조가 달라 검증이 안 됨).

## 파일 구조

- `site/` 정적 화면(배포 시 그대로 공개)
  - `app.js` 화면, `charts.js` 차트, `format.js` 표시 형식, `settings.js` 데이터 출처·최소 갱신 간격, `share.js` 이미지 공유
  - `remote.js` /api에서 관측을 받아 모으고 `core/api.js`로 계산, 서버가 정한 갱신 간격 보관
  - `core/` 계산(브라우저·Worker 공용, 외부 라이브러리 없음): `config.js` 후보·규칙·수집 기준·점검 표시,
    `scoring.js` 점수·순위·역전 필요 표, `history.js` 시각 기준·시계열, `api.js` 화면 데이터,
    `fakeSource.js`·`mockApi.js` 가짜 데이터(로컬 미리보기용)
- `worker/index.js` 멜론 수집(Cron), GitHub 수집 받기(/api/ingest/*), 갱신 간격 계산, /api(init, latest, now), /history.
  `worker/adapters/` 멜론·베리즈 응답 해석(`parse`), `worker/schema.sql` D1 표
- `scripts/github_collect.py` GitHub 수집, `scripts/backup.py` 백업, `scripts/health.py` 상태 확인,
  `scripts/seed-local.mjs` 로컬 D1에 가짜 관측 채우기(원격은 건드리지 않음)
- `tests/` 자동 시험, `backup/` 백업 파일, `.github/workflows/` 수집·백업·상태 확인·시험
- `wrangler.jsonc` Worker 설정, `package.json` 명령(test, dev, deploy, db:init:local/remote)

## 실행 방법

- 가짜 데이터 미리보기: `미리보기.bat` 또는 `python -m http.server 8000 --directory site` → http://localhost:8000/
  (포트 8000이나 `?mock`이면 브라우저 안 가짜 API, 점검 중 표시도 무시)
- Worker까지 로컬 실행: `npm run db:init:local`, `node scripts/seed-local.mjs`, `npm run dev` → http://localhost:8787/
  수집 1회: http://localhost:8787/__scheduled?cron=*+*+*+*+*
  GitHub 수집 시험: `INGEST_BASE=http://localhost:8787/api/ingest`, `INGEST_TOKEN=.dev.vars 값`으로 `python scripts/github_collect.py --once`
- Claude 앱 PowerShell에서는 PATH를 다시 읽고(`$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + ...User`)
  wrangler는 `node node_modules/wrangler/bin/wrangler.js ...`, `$env:CI="true"`로 실행한다.
- D1 문장은 100KB 제한, 무료 플랜은 실행당 D1 쿼리 50개 제한(GitHub 멜론 묶음을 15개로 나누는 이유).
- npm 12는 설치 스크립트를 막는다. workerd, esbuild는 `npm install-scripts approve`로 허용해 두었다.
- PowerShell 5.1의 `Set-Content -Encoding utf8`은 BOM을 붙인다. 파일 수정은 Edit 도구로 한다.
- 커밋 작성자 이메일은 GitHub noreply 주소(338686815+WONIWONIWONIWONI@users.noreply.github.com)를 쓴다.

## 참고

- 이전 트래커(코드 참고용, 그대로 복사하지 않음): https://github.com/WONIWONIWONIWONI/mma-vote-tracker
- 이전 KGMA 베리즈 트래커: https://github.com/WONIWONIWONIWONI/kgma-vote-tracker (GitHub Actions로 베리즈를 읽던 방식)
