"""Loki 에서 RUN 들의 기대 log_id 집합과 수신 집합을 비교한다. 사용: check.py RUN:COUNT ..."""
import json, sys, time, urllib.parse, urllib.request, uuid, collections
BASE = "http://127.0.0.1:13100"
NS = uuid.UUID("00000000-0000-0000-0000-000000002555")

def get(path, **q):
    with urllib.request.urlopen(BASE + path + "?" + urllib.parse.urlencode(q), timeout=30) as r:
        return json.load(r)

def lines(selector):
    out = []
    data = get("/loki/api/v1/query_range", query=selector, limit=5000, start=int((time.time() - 3600) * 1e9), direction="forward")
    for s in data["data"]["result"]:
        out += [(json.loads(v[1]), s["stream"]) for v in s["values"]]
    return out

if __name__ == "__main__":
    got = collections.Counter()
    records = lines('{env=~".+"}')
    for rec, _ in records:
        if "log_id" in rec: got[rec["log_id"]] += 1
    for spec in sys.argv[1:]:
        run, count = spec.split(":")
        expected = {str(uuid.uuid5(NS, f"{run}-{i}")) for i in range(int(count))}
        seen = {k for k in got if k in expected}
        dup = sum(got[k] - 1 for k in seen)
        print(f"run={run} expected={len(expected)} received={len(seen)} missing={len(expected - seen)} duplicates={dup}")
