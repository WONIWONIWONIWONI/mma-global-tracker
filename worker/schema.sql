-- 관측 원본: 사이트별 1분 1행. 기본 키가 (사이트, 시각) 순서라 따로 색인을 두지 않는다(쓰기 행 수 절약).
CREATE TABLE IF NOT EXISTS obs (
  source TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  source_at INTEGER,
  total_votes INTEGER,
  candidates TEXT NOT NULL,
  PRIMARY KEY (source, observed_at)
) WITHOUT ROWID;

-- 화면용 조각: 관측 JSON 한 줄 + "," 를 계속 이어 붙인 문자열. 키는 worker/index.js 참고.
CREATE TABLE IF NOT EXISTS blob (
  k TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
