"""canary 도착 검사. Loki 조회와 S3 객체 조회를 «각각 따로» 해서, 합성 canary(log_id)가 두 곳에 도착했는지와 지연을 잰다.
사용: canary.py [--max-delay SEC] [--interval SEC] [--allow-loss-window START:END]... [--allow-loss-file PATH]
  SIGTERM(또는 Ctrl-C)을 받을 때까지 관측하고, 그 뒤 max(max-delay, 2*interval+5) 초 더 조회한 다음 판정한다 — 관측 창 = 시나리오 전체 + 그 여유.
  --interval 은 Fluent Bit canary 입력(dummy `Rate`)의 발행 간격과 같아야 한다(기본 60초 = fluent-bit.conf 의 canary 입력). 다르면 번호 공백의 발행 시각 추정과 꼬리 여유가 틀어진다.
판정(하나라도 있으면 종료 코드 1):
  MISSING_IN    한 sink 에 발행 뒤 max-delay 가 지나도록 없음(또는 max-delay 보다 늦게 도착)
  MISSING_BOTH  canary_seq 의 빠진 번호 — 어느 sink 에도 안 온 canary. 같은 canary_boot(수집기 프로세스) 안에서 번호 연속성으로 찾는다
  STALE         sink 별 «마지막으로 받은 canary 의 발행 시각»이 판정 시각보다 interval + max-delay 넘게 오래됨
                (처음 몇 건만 오고 수집기가 멈췄거나 조회가 계속 실패한 경우 — 빠진 번호로는 안 보인다)
  CANARY_NONE   관측 동안 그 sink 에서 0건
  PENDING       판정 시각 기준 max-delay 안에 발행돼 아직 판정하지 않은 것. 성공으로 세지 않고 따로 출력한다.
--allow-loss-window START:END (epoch 초, 반복 가능) / --allow-loss-file PATH (한 줄에 START:END): 유실을 일부러 만드는 시나리오(f1·f2)의 시간 창.
  그 창 안에서 «발행된» canary 의 MISSING_* 만 ALLOWED_LOSS 로 출력하고 종료 코드에서 뺀다. 창 밖의 유실은 그대로 실패, STALE·NONE 도 그대로 실패.
꼬리 유실의 한계: 번호 공백은 «뒤 번호가 어느 한 sink 에라도 도착해야» 보인다.
  · 마지막 시나리오가 끝난 뒤에도 canary 가 최소 2주기 더 발행되도록 관측을 2*interval+5 초 이상 이어 간다 — 실행 끝의 꼬리 유실은 뒤 번호의 도착으로 공백이 된다.
  · 그래도 못 잡는 것: ① 한 boot 의 «마지막 번호들»(수집기가 SIGKILL·교체로 끝난 boot 의 꼬리) — 뒤 번호가 같은 boot 에 없다. ② 관측이 끝나기 직전 2주기 안의 발행분(PENDING).
    ③ 실행 전체가 끝나기 전에 수집기가 죽어 canary 가 더 안 나오는 경우는 STALE(interval + max-delay 초과)로만 잡는다.
운영 적용(설계): Loki/S3 조회를 각각 주기적으로 실행해 «마지막 canary 도착 시각»을 지표로 내고, 한쪽만 늦으면 그 sink 의 경보를 낸다."""
import calendar, json, signal, sys, time
import sinks

opt = lambda name, default: float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default
max_delay, interval = opt("--max-delay", 600.0), opt("--interval", 60.0)
tail_wait = max(max_delay, 2 * interval + 5)  # SIGTERM 뒤 더 보는 시간 — 꼬리 유실이 «뒤 번호 도착»으로 공백이 되려면 최소 2주기 더 발행돼야 한다


def load_windows():  # 판정 직전에 읽는다 — run-s3.sh 는 canary 를 먼저 띄우고 f1·f2 창을 나중에 파일에 적는다
    spec = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--allow-loss-window"]
    if "--allow-loss-file" in sys.argv:
        try:
            spec += open(sys.argv[sys.argv.index("--allow-loss-file") + 1]).read().split()
        except OSError:
            pass
    return [tuple(float(x) for x in w.split(":")) for w in spec]

SINKS = ("loki", "s3")
canaries, seen_keys = {}, set()  # log_id -> {emitted, boot, seq, loki, s3}
stop_at = None


def on_stop(*_):
    global stop_at
    stop_at = stop_at or time.time()


signal.signal(signal.SIGTERM, on_stop)
signal.signal(signal.SIGINT, on_stop)
obs_start = time.time() - 30
start_ns = int(obs_start * 1e9)


def ts_of(rec):
    return calendar.timegm(time.strptime(rec["timestamp"][:19], "%Y-%m-%dT%H:%M:%S")) + int(rec["timestamp"][20:23]) / 1000


def note(sink, rec):
    c = canaries.setdefault(rec["log_id"], {"emitted": ts_of(rec), "boot": rec.get("canary_boot"), "seq": rec.get("canary_seq")})
    c.setdefault(sink, time.time())


while stop_at is None or time.time() < stop_at + tail_wait:
    try:  # Loki 쪽
        for _, _, line in sinks.loki_query('{service="canary"}', start_ns):
            note("loki", json.loads(line))
    except Exception as e:
        print("loki query error:", e, flush=True)
    try:  # S3 쪽 — Loki 결과와 무관하게 객체를 직접 읽는다
        for key, _ in sinks.s3_list("system_log/v2/env=dev/service=canary/"):
            if key in seen_keys:
                continue
            recs = sinks.s3_records(key)  # 읽기에 실패하면 seen_keys 에 넣지 않는다 → 다음 회차에 다시 읽는다
            seen_keys.add(key)
            for rec in recs:
                note("s3", rec)
    except Exception as e:
        print("s3 query error:", e, flush=True)
    time.sleep(2)

now = time.time()
windows = load_windows()
in_window = lambda t: any(a <= t <= b for a, b in windows)
bad = loss = allowed = pending = 0
# 빠진 번호: 같은 boot 에서 받은 번호 사이의 빈 번호, 그리고 관측 시작 뒤에 발행됐을 앞 번호(발행 시각은 다음 번호에서 interval 로 추정).
by_boot = {}
for c in canaries.values():
    if isinstance(c.get("seq"), int):
        by_boot.setdefault(c["boot"], {})[c["seq"]] = c
for boot, seqs in sorted(by_boot.items(), key=lambda kv: min(c["emitted"] for c in kv[1].values())):
    for s in range(1, max(seqs)):
        if s in seqs:
            continue
        nxt = min(k for k in seqs if k > s)
        est = seqs[nxt]["emitted"] - (nxt - s) * interval
        if est < obs_start + interval / 2:
            continue  # 관측 시작 전에 발행됐을 번호
        if now - est > max_delay:
            ok = in_window(est)
            loss += not ok
            allowed += ok
            print(f"CANARY\tboot={boot}\tseq={s}\t{'ALLOWED_LOSS' if ok else 'MISSING_BOTH'}\t발행 추정 {time.strftime('%H:%M:%S', time.gmtime(est))}Z")
        else:
            pending += 1
            print(f"CANARY\tboot={boot}\tseq={s}\tPENDING\t어느 sink 에도 아직 없음")
for lid, c in sorted(canaries.items(), key=lambda kv: kv[1]["emitted"]):
    d = {k: (round(c[k] - c["emitted"], 1) if k in c else None) for k in SINKS}
    late = [k for k in SINKS if (d[k] is None and now - c["emitted"] > max_delay) or (d[k] is not None and d[k] > max_delay)]
    wait = [k for k in SINKS if d[k] is None and k not in late]
    ok = bool(late) and in_window(c["emitted"])
    loss += bool(late) and not ok
    allowed += ok
    pending += bool(wait and not late)
    tail = f"\t{'ALLOWED_LOSS' if ok else 'MISSING_IN'}={late}" if late else (f"\tPENDING={wait}" if wait else "")
    print(f"CANARY\t{lid}\tboot={c['boot']}\tseq={c['seq']}\tloki_delay={d['loki']}\ts3_delay={d['s3']}{tail}")
for k in SINKS:
    got = [c for c in canaries.values() if k in c]
    xs = sorted(c[k] - c["emitted"] for c in got)
    if not got:
        bad += 1
        print(f"CANARY_NONE\t{k}\t관측 동안 수신 0")
    elif now - max(c["emitted"] for c in got) > interval + max_delay:
        bad += 1
        print(f"STALE\t{k}\t마지막 수신 canary 발행 {now - max(c['emitted'] for c in got):.0f}s 전 (> interval {interval:.0f} + max-delay {max_delay:.0f})")
    print(f"CANARY_SUMMARY\t{k}\tcount={len(xs)}\tp50={xs[len(xs)//2]:.1f}s\tmax={xs[-1]:.1f}s" if xs else f"CANARY_SUMMARY\t{k}\tcount=0")
print(f"CANARY_JUDGED\tcanaries={len(canaries)}\tboots={len(by_boot)}\tmissing={loss}\tallowed_loss={allowed}\twindows={len(windows)}\tpending={pending}\tmax_delay={max_delay:.0f}s"
      f"\tobserved={now - obs_start:.0f}s" )
sys.exit(1 if bad or loss else 0)
