# 화면용 지난 날짜 파일

매일 00:30 KST에 GitHub Actions(`scripts/backup.py`)가 끝난 투표 날짜의 5분 간격 관측을 `날짜.json`으로 만든다.
Cloudflare에 정적 파일로 올라가 무료·무제한으로 제공되고, 파일이 없으면 Worker가 D1에서 같은 내용을 대신 준다.
형식: `{"day":"YYYY-MM-DD","lines":[관측...]}` (관측 형식은 `backup/README.md`와 같다)
