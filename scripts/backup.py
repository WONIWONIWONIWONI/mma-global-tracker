"""D1의 관측 원본(obs 표)을 KST 날짜별 파일로 백업하고, 끝난 날짜의 화면용 정적 파일(site/history/)도 만든다.
GitHub Actions(.github/workflows/backup.yml)가 하루 한 번 실행한다.

- 파일: backup/obs-YYYY-MM-DD.ndjson.gz  (그 KST 날짜 00:00 이상 ~ 다음 날 00:00 미만에 관측된 줄)
- 한 줄 = 관측 1회: {"source","observedAt","sourceAt","totalVotes","candidates":{후보id: 득표수}}
- 끝난 지 3일 이내의 날짜는 매번 다시 만든다(한도 초과 등으로 늦게 채워진 관측 반영. 내용이 같으면 파일도 같아 커밋 안 됨).
  그보다 오래된 날짜 파일은 건드리지 않는다. 빠진 날이 있으면 다음 실행에서 채운다.
- 필요한 환경 변수: CF_API_TOKEN(D1 읽기 권한), CF_ACCOUNT_ID. 데이터베이스 ID는 wrangler.jsonc에서 읽는다.
- 실행: python scripts/backup.py [--dry-run]
"""
import datetime as dt
import gzip
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backup"
KST = dt.timezone(dt.timedelta(hours=9))
SETTLE = dt.timedelta(minutes=10)  # 날짜가 바뀐 뒤 마지막 수집이 끝날 여유
REFRESH = dt.timedelta(days=3)     # 끝난 지 이 기간 안의 날짜는 매번 다시 만든다(늦게 채워진 관측 반영)


def recent(day: dt.date, now: dt.datetime) -> bool:
    return dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), KST) + REFRESH > now


def database_id() -> str:
    m = re.search(r'"database_id"\s*:\s*"([0-9a-f-]{36})"', (ROOT / "wrangler.jsonc").read_text(encoding="utf-8"))
    if not m:
        sys.exit("wrangler.jsonc에서 database_id를 찾지 못했습니다")
    return m.group(1)


def vote_start() -> dt.date:
    """site/core/config.js 의 VOTE.start 날짜. 이 날 이전(시험용 가짜 데이터)은 백업하지 않는다."""
    m = re.search(r'start:\s*"(\d{4}-\d{2}-\d{2})', (ROOT / "site" / "core" / "config.js").read_text(encoding="utf-8"))
    if not m:
        sys.exit("config.js에서 VOTE.start를 찾지 못했습니다")
    return dt.date.fromisoformat(m.group(1))


def query(sql: str, params=()):
    account, token = os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CF_API_TOKEN")
    if not account or not token:
        sys.exit("CF_ACCOUNT_ID, CF_API_TOKEN 환경 변수가 필요합니다")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database_id()}/query"
    req = urllib.request.Request(url, data=json.dumps({"sql": sql, "params": list(params)}).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = json.load(r)
    if not body.get("success"):
        sys.exit(f"D1 조회 실패: {body.get('errors')}")
    return body["result"][0]["results"]


def main() -> None:
    dry = "--dry-run" in sys.argv
    span = query("SELECT MIN(observed_at) AS a, MAX(observed_at) AS b, COUNT(*) AS n FROM obs")[0]
    if not span["n"]:
        print("관측이 아직 없습니다")
        return
    now = dt.datetime.now(KST)
    first = max(dt.datetime.fromtimestamp(span["a"] / 1000, KST).date(), vote_start())
    print(f"D1 관측 {span['n']}개 · {first} 부터")
    OUT.mkdir(exist_ok=True)
    written = 0
    day = first
    while True:
        start = dt.datetime.combine(day, dt.time(), KST)
        end = start + dt.timedelta(days=1)
        if end + SETTLE > now:
            break  # 아직 끝나지 않은 날
        path = OUT / f"obs-{day}.ndjson.gz"
        if not path.exists() or recent(day, now):
            rows = query("SELECT source, observed_at, source_at, total_votes, candidates FROM obs "
                         "WHERE observed_at >= ? AND observed_at < ? ORDER BY observed_at, source",
                         (int(start.timestamp() * 1000), int(end.timestamp() * 1000)))
            print(f"{day}: {len(rows)}줄{' (저장 안 함, 미리보기)' if dry else ''}")
            if rows and not dry:
                lines = "".join(json.dumps({"source": r["source"], "observedAt": r["observed_at"], "sourceAt": r["source_at"],
                                            "totalVotes": r["total_votes"], "candidates": json.loads(r["candidates"])},
                                           ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
                with open(path, "wb") as f, gzip.GzipFile(fileobj=f, mode="wb", mtime=0) as gz:
                    gz.write(lines.encode("utf-8"))
                written += 1
            time.sleep(0.5)
        day += dt.timedelta(days=1)
    print(f"새 백업 파일 {written}개")
    make_history(first, now, dry)


def make_history(first: dt.date, now: dt.datetime, dry: bool) -> None:
    """끝난 날짜의 화면용 5분 간격 조각(D1 blob 'd:날짜')을 site/history/날짜.json 정적 파일로 만든다.
    배포되면 화면이 이 파일을 받으므로 Worker 요청·CPU를 쓰지 않는다. 끝난 지 3일 이내 날짜만 다시 만든다.
    늦게 채워진 관측은 시각순이 아니게 붙으므로 시각순으로 정렬해 쓴다."""
    out = ROOT / "site" / "history"
    out.mkdir(exist_ok=True)
    made, day = 0, first
    while dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), KST) + SETTLE <= now:
        path = out / f"{day}.json"
        if not path.exists() or recent(day, now):
            rows = query("SELECT body FROM blob WHERE k = ?", (f"d:{day}",))
            if rows and rows[0]["body"]:
                lines = json.loads("[" + rows[0]["body"].rstrip(",") + "]")
                lines.sort(key=lambda o: (o["observedAt"], o["source"]))
                text = '{"day":"%s","lines":%s}' % (day, json.dumps(lines, ensure_ascii=False, separators=(",", ":")))
                old = path.read_text(encoding="utf-8") if path.exists() else None
                print(f"history {day}: {len(lines)}줄{' (미리보기)' if dry else ''}{' (변화 없음)' if old == text else ''}")
                if not dry and old != text:
                    path.write_text(text, encoding="utf-8")
                    made += 1
            time.sleep(0.3)
        day += dt.timedelta(days=1)
    print(f"새로 쓴 화면용 날짜 파일 {made}개")


if __name__ == "__main__":
    main()
