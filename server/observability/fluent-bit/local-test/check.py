"""Loki 에서 RUN 들의 기대 log_id 집합과 수신 집합을 비교한다. 사용: check.py [--wait 초] RUN:COUNT ...

--wait: 누락이 없어질 때까지 폴링(상한 시간). 고정 sleep 을 쓰지 않아 느린 머신에서 가짜 실패가, 빠른 머신에서 낭비가 없다.

중복 0 판정의 한계: Loki 는 같은 스트림에서 시각·본문이 완전히 같은 항목을 제거한다. 줄 본문에 수집기가 넣는
observed_at(초 단위)이 있어서 «재전송으로 생긴 중복» 이 제거되지 않고 보이지만, 같은 초 안의 재전송은 가려질 수 있다.
"""
import json, sys, time, urllib.parse, urllib.request, uuid, collections
BASE = "http://127.0.0.1:13100"
NS = uuid.UUID("00000000-0000-0000-0000-000000002555")

def get(path, **q):
    with urllib.request.urlopen(BASE + path + "?" + urllib.parse.urlencode(q), timeout=30) as r:
        return json.load(r)

def lines(selector):
    out = []
    data = get("/loki/api/v1/query_range", query=selector, limit=5000, start=int((time.time() - 4 * 3600) * 1e9), direction="forward")
    for s in data["data"]["result"]:
        out += [(json.loads(v[1]), s["stream"]) for v in s["values"]]
    return out

def evaluate(specs):
    got = collections.Counter()
    for rec, _ in lines('{env=~".+"}'):
        if "log_id" in rec: got[rec["log_id"]] += 1
    rows, bad = [], False
    for spec in specs:
        run, count = spec.split(":")
        expected = {str(uuid.uuid5(NS, f"{run}-{i}")) for i in range(int(count))}
        seen = {k for k in got if k in expected}
        dup = sum(got[k] - 1 for k in seen)
        rows.append(f"run={run} expected={len(expected)} received={len(seen)} missing={len(expected - seen)} duplicates={dup}")
        bad |= len(expected - seen) > 0 or dup > 0
    return rows, bad

if __name__ == "__main__":
    args = sys.argv[1:]
    wait = 0
    if args[:1] == ["--wait"]:
        wait, args = int(args[1]), args[2:]
    deadline = time.time() + wait
    while True:
        rows, bad = evaluate(args)
        if not bad or time.time() >= deadline: break
        time.sleep(2)
    if wait and not bad:
        time.sleep(4)  # 늦게 도착하는 중복을 잡을 짧은 여유
        rows, bad = evaluate(args)
    print("\n".join(rows))
    sys.exit(1 if bad else 0)
