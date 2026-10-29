# 관측 백업

Cloudflare D1에 쌓인 관측 원본을 하루 한 번(00:30 KST) GitHub Actions가 날짜별로 저장한다.

- 파일: `obs-YYYY-MM-DD.ndjson.gz` — 그 KST 날짜 00:00 이상, 다음 날 00:00 미만에 관측된 기록
- 한 줄 = 관측 1회(사이트 하나):
  `{"source":"melon","observedAt":밀리초,"sourceAt":null,"totalVotes":숫자,"candidates":{"bts":숫자,...}}`
- 00시 수집은 몇 초 차이로 전날 파일 끝이나 다음 날 파일 처음에 있다. 화면은 관측 시각을 가장 가까운 정각 분으로 맞춰
  00:00 수집을 그날 마감값으로 쓴다.
- 투표 주소 공개 전에는 가짜 데이터다.
- 만드는 스크립트: `scripts/backup.py`
