#!/usr/bin/env python3
"""GROMO-2560 로컬 수집기 비용 측정(V14 의 수집기 부분). 사용: collector_cost.py [RATE:SECONDS ...]  (기본 200:60 1000:60)

로컬 Docker 만 쓴다(AWS·dev·prod 로 요청을 보내지 않는다). 각 속도마다 compose 프로젝트 obs2562-2560perf 를 새로 띄워 측정하고 `down -v` 한다.
- 수집기 CPU·메모리: `docker stats --no-stream` 을 반복 호출(CPU 100% = 코어 1개).
- 버퍼 디스크: 상태 볼륨(tail DB + 엔진 버퍼)의 `du -sk` 를 10초마다.
- 도착 지연: 2초마다 Loki 를 조회해 log_id 별 «처음 본 시각» − emitted_ms. 해상도 약 2초. 생성기 시계(Docker VM)와 호스트 시계 차이는
  시작·끝에 재서 평균을 빼고 그 값을 출력한다. Loki 가 응답한 시각까지의 지연이다(수집기→Loki 인입 완료 기준).
"""
import collections, json, statistics, subprocess, sys, threading, time, urllib.parse, urllib.request

HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
P = "obs2562-2560perf"
C = ["docker", "compose", "-p", P, "-f", f"{HERE}/docker-compose.yml"]
LOKI = "http://127.0.0.1:23100"
FB = "http://127.0.0.1:22020"


def sh(cmd, check=True):
    return subprocess.run(cmd, capture_output=True, text=True, check=check).stdout.strip()


CLK = "clk2560"


def clock_offset_ms():
    """컨테이너(VM) 시계 − 호스트 시계(ms). 호스트 호출 전후 중간값을 기준으로 5번 재서 왕복이 가장 짧은 것을 쓴다(NTP 방식).
    (busybox date 는 %N 을 못 쓴다 — 실행 중인 python 컨테이너에 exec 한다.) 반환: (오프셋 ms, 왕복 ms)."""
    best = None
    for _ in range(5):
        t0 = time.time_ns()
        vm = int(sh(["docker", "exec", CLK, "python", "-c", "import time;print(time.time_ns())"]))
        t1 = time.time_ns()
        cand = ((vm - (t0 + t1) / 2) / 1e6, (t1 - t0) / 1e6)
        best = cand if best is None or cand[1] < best[1] else best
    return best


def pct(vals, q):
    s = sorted(vals)
    return s[min(len(s) - 1, int(q * len(s) + 0.999999) - 1)]


def loki_get(path, **q):
    with urllib.request.urlopen(f"{LOKI}{path}?{urllib.parse.urlencode(q)}", timeout=30) as r:
        return json.load(r)


def wait_ready():
    for _ in range(90):
        try:
            urllib.request.urlopen(f"{LOKI}/ready", timeout=3)
            urllib.request.urlopen(f"{FB}/api/v1/metrics", timeout=3)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("loki/fluent-bit 가 준비되지 않음")


def fb_metrics():
    out = json.load(urllib.request.urlopen(f"{FB}/api/v1/metrics", timeout=5))["output"]
    return {k: {m: v.get(m, 0) for m in ("proc_records", "retried_records", "dropped_records", "errors")} for k, v in out.items()}


def parse_mem(s):  # "12.3MiB / 7.6GiB"
    used = s.split("/")[0].strip()
    for unit, mul in (("GiB", 1024), ("MiB", 1), ("KiB", 1 / 1024)):
        if used.endswith(unit):
            return float(used[:-len(unit)]) * mul
    return float(used.rstrip("B")) / 1048576


def run_one(rate, seconds):
    sh(C + ["--profile", "gen", "down", "-v", "--remove-orphans"], check=False)
    sh(C + ["up", "-d", "loki", "fluent-bit"])
    wait_ready()
    fb_id = sh(C + ["ps", "-q", "fluent-bit"])
    stats, disk, first_seen, stop = [], [], {}, threading.Event()
    emitted = {}

    def sample_stats():
        while not stop.is_set():
            out = sh(["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", fb_id], check=False)
            if "|" in out:
                cpu, mem = out.split("|")
                stats.append((time.time(), float(cpu.rstrip("%")), parse_mem(mem)))

    def sample_disk():
        while not stop.is_set():
            out = sh(["docker", "run", "--rm", "-v", f"{P}_fluent_bit_state:/s:ro", "alpine", "du", "-sk", "/s"], check=False)
            if out:
                disk.append((time.time(), int(out.split()[0])))
            stop.wait(10)

    def poll():
        cursor = int((time.time() - 60) * 1e9)
        while True:
            last_round = stop.is_set()
            start = cursor - 3_000_000_000  # 늦게 인입되는 줄을 놓치지 않게 3초 겹쳐 읽는다
            while True:
                data = loki_get("/loki/api/v1/query_range", query='{env="dev",service="data-api"}', limit=5000, start=start, direction="forward")
                n, lastts = 0, start
                now = time.time()
                for s in data["data"]["result"]:
                    for ts, line in s["values"]:
                        n += 1
                        lastts = max(lastts, int(ts))
                        try:
                            rec = json.loads(line)
                        except ValueError:
                            continue
                        if "emitted_ms" in rec and rec["log_id"] not in first_seen:
                            first_seen[rec["log_id"]] = now
                            emitted[rec["log_id"]] = rec["emitted_ms"]
                if n < 5000:
                    break
                start = lastts + 1
            cursor = max(cursor, lastts)
            if last_round:
                return
            time.sleep(1.5)

    sh(["docker", "rm", "-f", CLK], check=False)
    sh(["docker", "run", "-d", "--name", CLK, "python:3.12-alpine", "sleep", "3600"])
    off0 = clock_offset_ms()
    idle = []
    for _ in range(4):  # 유휴 기준값(생성기 시작 전)
        out = sh(["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", fb_id])
        idle.append((float(out.split("|")[0].rstrip("%")), parse_mem(out.split("|")[1])))
    threads = [threading.Thread(target=f, daemon=True) for f in (sample_stats, sample_disk, poll)]
    t_start = time.time()
    for t in threads:
        t.start()
    sh(C + ["--profile", "gen", "run", "-d", "--name", f"gen2560_{rate}", "data-api", str(rate), str(seconds)])
    time.sleep(seconds + 5)
    done = sh(["docker", "logs", f"gen2560_{rate}"], check=False).splitlines()[-1]
    total = int(done.split("emitted=")[1].split()[0])
    deadline = time.time() + 90  # 도착 대기 상한
    while len(first_seen) < total and time.time() < deadline:
        time.sleep(2)
    t_end = time.time()
    stop.set()
    for t in threads:
        t.join(timeout=60)
    off1 = clock_offset_ms()
    sh(["docker", "rm", "-f", CLK], check=False)
    metrics = fb_metrics()
    offset = (off0[0] + off1[0]) / 2
    lat = [first_seen[k] * 1000 - emitted[k] - offset for k in first_seen]
    window = [s for s in stats if t_start <= s[0] <= t_start + seconds + 5]
    cpu = [s[1] for s in window]
    mem = [s[2] for s in window]
    res = {
        "rate": rate, "seconds": seconds, "emitted": total, "received": len(first_seen), "missing": total - len(first_seen),
        "clock_offset_ms_start_end": (round(off0[0], 1), round(off1[0], 1)), "clock_rtt_ms_start_end": (round(off0[1], 1), round(off1[1], 1)),
        "lat_s": {q: round(pct(lat, v) / 1000, 2) for q, v in (("p50", .5), ("p95", .95), ("p99", .99), ("max", 1.0))} if lat else None,
        "lat_negative": sum(1 for x in lat if x < 0),
        "cpu_pct_idle": round(statistics.mean(i[0] for i in idle), 2), "mem_mib_idle": round(statistics.mean(i[1] for i in idle), 1),
        "cpu_pct": {"samples": len(cpu), "mean": round(statistics.mean(cpu), 1), "p95": round(pct(cpu, .95), 1), "max": round(max(cpu), 1)} if cpu else None,
        "mem_mib_max": round(max(mem), 1) if mem else None,
        "disk_kib_max": max((d[1] for d in disk), default=None), "disk_samples": len(disk),
        "fluent_bit": metrics, "wall_s": round(t_end - t_start, 1),
    }
    sh(["docker", "rm", "-f", f"gen2560_{rate}"], check=False)
    sh(C + ["--profile", "gen", "down", "-v", "--remove-orphans"], check=False)
    return res


if __name__ == "__main__":
    specs = sys.argv[1:] or ["200:60", "1000:60"]
    try:
        for spec in specs:
            rate, seconds = map(int, spec.split(":"))
            print(json.dumps(run_one(rate, seconds), ensure_ascii=False, indent=1), flush=True)
    finally:
        sh(C + ["--profile", "gen", "down", "-v", "--remove-orphans"], check=False)
