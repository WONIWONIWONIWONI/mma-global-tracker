"""트래커 상태 확인. GitHub Actions(.github/workflows/health.yml)가 30분마다 실행한다.

투표 기간에만 확인하고, 문제가 있으면 GITHUB_OUTPUT 에 problem=설명 을 남긴다(워크플로가 이슈를 열어 알림).
확인 항목: API 응답(하루 요청 한도 초과 포함), 사이트별 마지막 관측이 15분 넘게 지났는지, 아직 가짜 데이터인지.
실행: python scripts/health.py [--force]   (--force: 투표 기간이 아니어도 확인)
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://mma-global-tracker.happyapple.workers.dev"
STALE_MIN = 15


def vote_window():
    text = (ROOT / "site" / "core" / "config.js").read_text(encoding="utf-8")
    s = re.search(r'start:\s*"([^"]+)"', text).group(1)
    e = re.search(r'end:\s*"([^"]+)"', text).group(1)
    return dt.datetime.fromisoformat(s), dt.datetime.fromisoformat(e)


def check() -> list[str]:
    try:
        req = urllib.request.Request(SITE + "/api/latest", headers={"User-Agent": "mma-tracker-health"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        hint = " (하루 요청 한도 초과일 수 있음, KST 09시 초기화)" if e.code in (429, 403, 1027) else ""
        return [f"API 응답 오류 {e.code}{hint}"]
    except Exception as e:  # 연결 실패, JSON 아님 등
        return [f"API 접속 실패: {e}"]

    problems = []
    now_ms = dt.datetime.now(dt.timezone.utc).timestamp() * 1000
    for source, name in (("melon", "멜론"), ("berriz", "베리즈")):
        times = [o["observedAt"] for o in data.get("lines", []) if o.get("source") == source]
        if not times:
            problems.append(f"{name}: 최근 2시간 관측 없음")
        elif (now_ms - max(times)) / 60000 > STALE_MIN:
            problems.append(f"{name}: 마지막 관측이 {int((now_ms - max(times)) / 60000)}분 전")
    if data.get("sample"):
        problems.append("아직 가짜 데이터로 수집 중(실제 어댑터로 바꾸지 않음)")
    return problems


def main() -> None:
    start, end = vote_window()
    now = dt.datetime.now(dt.timezone.utc)
    if "--force" not in sys.argv and not (start + dt.timedelta(minutes=15) <= now <= end + dt.timedelta(minutes=30)):
        print("투표 기간이 아니어서 확인하지 않음")
        return
    problems = check()
    print("문제: " + " / ".join(problems) if problems else "정상")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"problem={' / '.join(problems)}\n")


if __name__ == "__main__":
    main()
