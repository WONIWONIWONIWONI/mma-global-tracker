"""베리즈 10분 집계 수집기. GitHub Actions(.github/workflows/berriz.yml)가 실행한다.

베리즈는 Cloudflare에서 오는 요청을 거절(HTTP 403)해서, 조회만 여기서 하고 결과는 Worker로 보낸다.
- 베리즈 득표수는 10분마다(00·10·20…분) 집계된다. 각 10분 경계 1분 뒤에 한 번 읽고, 아직 새 집계가 아니면
  30초 간격으로 6분 뒤까지만 다시 확인한다(보통 10분에 1~3번 요청).
- 새 집계면 원본 응답을 그대로 Worker의 /api/ingest/berriz 로 POST(비밀값 INGEST_TOKEN). 후보 매칭은 Worker가 한다.
- 한 번 실행은 최대 5시간 40분. 워크플로가 다음 실행을 미리 대기시켜 두어 이어서 돈다.
- 베리즈가 여기서도 거절(403)하면 3번 연속일 때 이 워크플로 예약을 끄고 멈춘다(차단을 피해 다른 곳으로 옮기지 않는다).
실행: python scripts/berriz_collect.py [--once]   (--once: 한 번만 읽고 보내기, 시험용)
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "https://svc-api.berriz.in/service/v1/votes/mma2026/stats?languageCode=en"
INGEST = os.environ.get("INGEST_URL", "https://mma-global-tracker.happyapple.workers.dev/api/ingest/berriz")
UA = "mma-global-tracker (unofficial vote tracker; every 10 min; +https://github.com/WONIWONIWONIWONI/mma-global-tracker)"
STEP = 600            # 베리즈 집계 간격(초)
FIRST_DELAY = 60      # 경계 뒤 첫 확인
RETRY = 30            # 새 집계가 아직이면 다시 확인하는 간격
GIVE_UP = 360         # 경계 뒤 이 시간까지만 재확인
RUN_LIMIT = int(os.environ.get("RUN_SECONDS", 5 * 3600 + 40 * 60))


def log(*a):
    print(dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%m/%d %H:%M:%S"), *a, flush=True)


def vote_window():
    text = (ROOT / "site" / "core" / "config.js").read_text(encoding="utf-8")
    s = re.search(r'start:\s*"([^"]+)"', text).group(1)
    e = re.search(r'end:\s*"([^"]+)"', text).group(1)
    return dt.datetime.fromisoformat(s).timestamp(), dt.datetime.fromisoformat(e).timestamp()


class Blocked(Exception):
    pass


def fetch():
    req = urllib.request.Request(SOURCE, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 403:
            raise Blocked()
        raise
    j = json.loads(body)
    return body, (j.get("data") or {}).get("aggregatedAt")


def post(body, token):
    req = urllib.request.Request(INGEST, data=body, method="POST", headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "mma-berriz-collector"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def disable_workflow():
    """베리즈가 GitHub에서도 거절하면 예약 실행을 끈다(GH_TOKEN 필요, Actions 쓰기 권한)."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    try:
        subprocess.run(["gh", "workflow", "disable", "berriz.yml", "--repo", os.environ["GITHUB_REPOSITORY"]], check=True)
        log("베리즈 수집 워크플로 예약을 껐습니다")
    except Exception as e:
        log("워크플로를 끄지 못함:", e)


def main():
    token = os.environ.get("INGEST_TOKEN")
    if not token:
        # 실패로 끝내면 15분마다 실패 메일이 가므로 조용히 끝낸다
        log("비밀값 INGEST_TOKEN 이 없어 수집하지 않습니다(GitHub 저장소 Settings → Secrets 에 등록 필요)")
        return
    start, end = vote_window()
    once = "--once" in sys.argv
    began = time.time()
    last_sent = None
    blocked = 0

    def attempt():
        """한 번 읽고, 새 집계면 보낸다. 새 집계를 보냈거나 이미 보낸 것이면 True."""
        nonlocal last_sent, blocked
        try:
            body, agg = fetch()
            blocked = 0
        except Blocked:
            blocked += 1
            log(f"베리즈가 요청을 거절함(403) {blocked}회 연속")
            if blocked >= 3:
                disable_workflow()
                sys.exit(1)
            return False
        except Exception as e:
            log("베리즈 조회 실패:", e)
            return False
        if agg is None:
            log("아직 집계 전")
            return False
        if agg == last_sent:
            return False
        status, text = post(body, token)
        log(f"집계 {agg} → Worker {status} {text[:200]}")
        if status == 401:
            log("Worker 인증 실패: GitHub과 Cloudflare의 INGEST_TOKEN 값이 같은지 확인하세요")
            sys.exit(1)
        if status == 200:
            last_sent = agg
            return True
        return False

    attempt()   # 시작하자마자 한 번(이전 실행과 교대하는 사이에 빠진 집계 채우기)
    if once:
        return
    while True:
        now = time.time()
        if now > end + 30 * 60:
            log("투표가 끝나 멈춥니다")
            return
        boundary = (now // STEP + 1) * STEP
        if boundary + GIVE_UP - began > RUN_LIMIT:
            log("이번 실행 시간이 다 되어 다음 실행에 넘깁니다")
            return
        if boundary + FIRST_DELAY < start:
            time.sleep(min(boundary + FIRST_DELAY - now, 600))
            continue
        time.sleep(max(0, boundary + FIRST_DELAY - time.time()))
        while not attempt() and time.time() < boundary + GIVE_UP:
            time.sleep(RETRY)


if __name__ == "__main__":
    main()
