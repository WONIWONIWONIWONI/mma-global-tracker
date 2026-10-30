"""GitHub Actions 수집기(.github/workflows/berriz.yml가 실행).

1. 베리즈(주 수집): 베리즈는 Cloudflare에서 오는 요청을 거절(403)해서 여기서 읽는다.
   득표수는 10분마다(00·10·20…분) 집계된다. 각 10분 경계 1분 뒤에 읽고, 아직 새 집계가 아니면
   30초 간격으로 6분 뒤까지만 다시 확인한다(보통 10분에 1~3번 요청). 새 집계는 원본 그대로 Worker로 보낸다.
2. 멜론(보조 수집): 평소 멜론은 Cloudflare가 20초마다 모은다. 여기서는 1분마다 읽어 5분마다 묶어 보내고,
   Worker는 이미 있는 분은 버리고 빠진 분만 채운다. Cloudflare가 하루 요청 한도에 걸려 저장이 안 될 때 기록을 지키는 장치.
3. 보내기가 실패하면(한도 초과 등) 값을 보관했다가 5분마다 다시 보낸다. 이번 실행이 끝날 때까지 못 보내면
   backup/pending.json 으로 저장소에 남기고, 다음 실행이 이어서 보낸다(다 보내면 파일을 지운다).

사이트가 여기서도 요청을 3번 연속 거절(403)하면 그 사이트 조회를 멈추고 scripts/blocked-<사이트> 표시 파일을 남긴다.
그 파일이 있으면 다음 실행부터도 조회하지 않는다(차단을 피해 다른 곳으로 옮기지 않는다). 다시 하려면 파일을 지운다.

한 번 실행은 최대 5시간 40분. 워크플로가 다음 실행을 미리 대기시켜 두어 이어서 돈다.
실행: python scripts/github_collect.py [--once]   (--once: 한 번씩 읽고 보내기, 시험용)
환경 변수: INGEST_TOKEN(필수), INGEST_BASE(시험용 Worker 주소), RUN_SECONDS
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
BERRIZ_URL = "https://svc-api.berriz.in/service/v1/votes/mma2026/stats?languageCode=en"
MELON_URL = "https://m2.melon.com/m6/mma/2026/vote/category.json?lang=ko"
MELON_CATEGORY = "V26005"
BASE = os.environ.get("INGEST_BASE", "https://mma-global-tracker.happyapple.workers.dev/api/ingest")
UA = "mma-global-tracker (unofficial vote tracker; +https://github.com/WONIWONIWONIWONI/mma-global-tracker)"
PENDING = ROOT / "backup" / "pending.json"

STEP = 600            # 베리즈 집계 간격(초)
FIRST_DELAY = 60      # 경계 뒤 첫 확인
RETRY = 30            # 새 집계가 아직이면 다시 확인하는 간격
GIVE_UP = 360         # 경계 뒤 이 시간까지만 재확인
MELON_BATCH = 15      # Worker가 한 번에 받는 멜론 관측 수
MELON_KEEP = 1500     # 못 보낸 멜론 관측 보관 상한(약 25시간)
RUN_LIMIT = int(os.environ.get("RUN_SECONDS", 5 * 3600 + 40 * 60))
IN_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"


def log(*a):
    print(dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%m/%d %H:%M:%S"), *a, flush=True)


def vote_window():
    text = (ROOT / "site" / "core" / "config.js").read_text(encoding="utf-8")
    s = re.search(r'start:\s*"([^"]+)"', text).group(1)
    e = re.search(r'end:\s*"([^"]+)"', text).group(1)
    return dt.datetime.fromisoformat(s).timestamp(), dt.datetime.fromisoformat(e).timestamp()


def git_commit(message):
    """저장소에 pending.json / 차단 표시 파일 변경을 올린다(Actions 안에서만)."""
    if not IN_ACTIONS:
        return
    try:
        subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
        subprocess.run(["git", "config", "user.email", "41898283+github-actions[bot]@users.noreply.github.com"], check=True)
        subprocess.run(["git", "add", "-A", "backup", "scripts"], check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode == 0:
            return
        subprocess.run(["git", "commit", "-q", "-m", message], check=True)
        for _ in range(3):
            subprocess.run(["git", "pull", "-q", "--rebase"], check=False)
            if subprocess.run(["git", "push", "-q"]).returncode == 0:
                log("저장소에 올림:", message)
                return
            time.sleep(5)
        log("저장소에 올리지 못함")
    except Exception as e:
        log("커밋 실패:", e)


class Blocked(Exception):
    pass


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 403:
            raise Blocked()
        raise


def post(path, data, headers=None):
    req = urllib.request.Request(BASE + path, data=data, method="POST", headers={
        "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "mma-github-collector", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)


class Site:
    """사이트별 연속 거절 횟수와 차단 표시."""
    def __init__(self, key):
        self.key, self.marker, self.denied = key, ROOT / "scripts" / f"blocked-{key}", 0
        self.off = self.marker.exists()
        if self.off:
            log(f"{key}: 차단 표시 파일이 있어 조회하지 않습니다({self.marker.name}을 지우면 다시 시도)")

    def call(self, url):
        try:
            body = get(url)
            self.denied = 0
            return body
        except Blocked:
            self.denied += 1
            log(f"{self.key}: 요청 거절(403) {self.denied}회 연속")
            if self.denied >= 3:
                self.off = True
                self.marker.write_text(f"{dt.datetime.now(dt.timezone.utc).isoformat()} 403 3회 연속. 이 파일을 지우면 다시 조회합니다.\n", encoding="utf-8")
                git_commit(f"Stop {self.key} collection: refused with HTTP 403")
            return None


def main():
    global TOKEN
    TOKEN = os.environ.get("INGEST_TOKEN")
    if not TOKEN:
        # 실패로 끝내면 15분마다 실패 메일이 가므로 조용히 끝낸다
        log("비밀값 INGEST_TOKEN 이 없어 수집하지 않습니다(GitHub 저장소 Settings → Secrets 에 등록 필요)")
        return
    start, end = vote_window()
    once = "--once" in sys.argv
    began = time.time()

    had_file = PENDING.exists()
    pending = json.loads(PENDING.read_text(encoding="utf-8")) if had_file else {}
    pend_m, pend_b = pending.get("melon", []), pending.get("berriz", [])
    if had_file:
        log(f"이전 실행이 남긴 미전송: 멜론 {len(pend_m)}개, 베리즈 {len(pend_b)}개")
    melon, berriz = Site("melon"), Site("berriz")
    state = {"seen": None}

    def fatal_auth():
        log("Worker 인증 실패: GitHub과 Cloudflare의 INGEST_TOKEN 값이 같은지 확인하세요")
        save_and_exit(1)

    def flush_melon():
        while pend_m:
            chunk = pend_m[:MELON_BATCH]
            status, text = post("/melon", json.dumps({"items": chunk}, separators=(",", ":")).encode())
            if status == 200:
                del pend_m[:len(chunk)]
                if '"stored":0' not in text:
                    log("멜론 보조 저장:", text[:120])
            elif status == 401:
                fatal_auth()
            elif status in (400, 413):
                log("멜론 묶음을 Worker가 받지 않아 버림:", status, text[:120])
                del pend_m[:len(chunk)]
            else:
                log(f"멜론 보내기 실패 {status}, 보관 {len(pend_m)}개:", text[:120])
                return

    def flush_berriz():
        while pend_b:
            x = pend_b[0]
            status, text = post("/berriz", x["body"].encode(), {"X-Observed-At": str(x["observedAt"])})
            if status == 200:
                pend_b.pop(0)
                log("베리즈:", text[:120])
            elif status == 401:
                fatal_auth()
            elif status in (400, 409, 413):
                log("베리즈 집계를 Worker가 받지 않아 버림:", status, text[:120])
                pend_b.pop(0)
            else:
                log(f"베리즈 보내기 실패 {status}, 보관 {len(pend_b)}개:", text[:120])
                return

    def save_and_exit(code=0):
        if pend_m or pend_b:
            PENDING.parent.mkdir(exist_ok=True)
            PENDING.write_text(json.dumps({"melon": pend_m[-MELON_KEEP:], "berriz": pend_b}, separators=(",", ":")), encoding="utf-8")
            git_commit(f"Keep unsent observations (melon {len(pend_m)}, berriz {len(pend_b)})")
        elif PENDING.exists():
            PENDING.unlink()
            git_commit("All kept observations sent")
        sys.exit(code)

    def read_melon():
        if melon.off:
            return
        body = melon.call(f"{MELON_URL}&t={int(time.time())}")
        if body is None:
            return
        try:
            cat = next(c for c in json.loads(body)["response"]["categories"] if c.get("categoryId") == MELON_CATEGORY)
            nominees = [{"id": str(n["content"]["id"]), "voteCount": n.get("voteCount")} for n in cat["nominees"]]
            pend_m.append({"observedAt": int(time.time() * 1000), "nominees": nominees})
            del pend_m[:-MELON_KEEP]
        except Exception as e:
            log("멜론 응답 형식이 다름:", e)

    def read_berriz():
        """새 집계면 보관 목록에 넣고 True."""
        if berriz.off:
            return False
        body = berriz.call(BERRIZ_URL)
        if body is None:
            return False
        try:
            agg = (json.loads(body).get("data") or {}).get("aggregatedAt")
        except Exception as e:
            log("베리즈 응답 형식이 다름:", e)
            return False
        if agg is None or agg == state["seen"]:
            return False
        state["seen"] = agg
        pend_b.append({"observedAt": int(time.time() * 1000), "body": body.decode("utf-8")})
        return True

    # 시작: 남은 것 먼저 보내고, 한 번씩 읽기
    read_berriz()
    flush_berriz()
    read_melon()
    flush_melon()
    if had_file and not pend_m and not pend_b:
        PENDING.unlink()
        git_commit("All kept observations sent")
    if once:
        save_and_exit()

    def next_boundary(t):
        return (t // STEP + 1) * STEP

    now = time.time()
    melon_due = (now // 60 + 1) * 60 + 3
    b_deadline = next_boundary(now) + GIVE_UP
    berriz_due = next_boundary(now) + FIRST_DELAY
    while True:
        now = time.time()
        if now > end + 30 * 60:
            log("투표가 끝나 멈춥니다")
            flush_melon(); flush_berriz()
            save_and_exit()
        if now - began > RUN_LIMIT:
            log("이번 실행 시간이 다 되어 다음 실행에 넘깁니다")
            flush_melon(); flush_berriz()
            save_and_exit()
        if now < start - 10 * 60:
            time.sleep(min(600, start - 10 * 60 - now))
            continue

        if now >= melon_due:
            read_melon()
            if int(melon_due // 60) % 5 == 0:   # 5분마다 묶어 보내기(실패분 재전송 포함)
                flush_melon()
                flush_berriz()
            melon_due = (time.time() // 60 + 1) * 60 + 3

        if now >= berriz_due:
            if read_berriz():
                flush_berriz()
                b_deadline = next_boundary(now) + GIVE_UP
                berriz_due = next_boundary(now) + FIRST_DELAY
            elif now + RETRY <= b_deadline:
                berriz_due = now + RETRY
            else:
                b_deadline = next_boundary(now) + GIVE_UP
                berriz_due = next_boundary(now) + FIRST_DELAY

        time.sleep(max(0.5, min(melon_due, berriz_due) - time.time()))


if __name__ == "__main__":
    main()
