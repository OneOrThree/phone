"""GROMO-2556 하네스 공용: Loki 조회와 S3(MinIO) 조회. 둘은 서로 독립이다(한쪽 실패가 다른 쪽 조회에 영향을 주지 않는다).
설정은 환경변수 — LOKI_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY. 로컬 MinIO 용이며 AWS 에는 쓰지 않는다."""
import datetime, gzip, hashlib, hmac, json, os, re, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

LOKI = os.environ.get("LOKI_URL", "http://127.0.0.1:23100")
ENDPOINT = os.environ.get("S3_ENDPOINT", "http://127.0.0.1:29000")
BUCKET = os.environ.get("S3_BUCKET", "obs-logs")
ACCESS = os.environ.get("S3_ACCESS_KEY", "harness-access")
SECRET = os.environ.get("S3_SECRET_KEY", "harness-secret-0123456789")
REGION = "us-east-1"


def loki_query(selector, start_ns, limit=5000):
    """[(stream_labels, ts_ns, line)] — start_ns 이후 전부, 오래된 것부터. Loki 는 한 번에 limit 건만 주므로 페이지가 가득 차면
    마지막 시각부터(포함) 다시 읽고, 경계 시각에서 겹친 항목은 (스트림, 시각, 본문)으로 걸러 낸다(Loki 도 이 셋이 같으면 한 건으로 저장)."""
    out, seen = [], set()
    while True:
        q = urllib.parse.urlencode({"query": selector, "limit": limit, "start": int(start_ns), "direction": "forward"})
        with urllib.request.urlopen(f"{LOKI}/loki/api/v1/query_range?{q}", timeout=20) as r:
            data = json.load(r)
        page = [(s["stream"], int(v[0]), v[1]) for s in data["data"]["result"] for v in s["values"]]
        for e in page:
            k = (tuple(sorted(e[0].items())), e[1], e[2])
            if k not in seen:
                seen.add(k)
                out.append(e)
        if len(page) < limit:
            return out
        last = max(ts for _, ts, _ in page)
        start_ns = last if last > start_ns else last + 1  # 한 시각에 limit 건 넘게 몰리면 그 시각의 나머지는 건너뛴다(사실상 없음)


def _hmac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _s3_request(path, query=None):
    query = query or {}
    host = urllib.parse.urlparse(ENDPOINT).netloc
    now = datetime.datetime.now(datetime.timezone.utc)
    amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(b"").hexdigest()
    cpath = urllib.parse.quote(path, safe="/-_.~")
    cquery = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(str(v), safe='-_.~')}" for k, v in sorted(query.items()))
    canon = f"GET\n{cpath}\n{cquery}\nhost:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz}\n\nhost;x-amz-content-sha256;x-amz-date\n{payload}"
    scope = f"{day}/{REGION}/s3/aws4_request"
    sts = f"AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(canon.encode()).hexdigest()}"
    k = _hmac(_hmac(_hmac(_hmac(("AWS4" + SECRET).encode(), day), REGION), "s3"), "aws4_request")
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={ACCESS}/{scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature={sig}"
    req = urllib.request.Request(f"{ENDPOINT}{cpath}" + (f"?{cquery}" if cquery else ""),
                                 headers={"x-amz-date": amz, "x-amz-content-sha256": payload, "Authorization": auth})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def s3_list(prefix="system_log/v2/"):
    keys, token = [], None
    while True:
        q = {"list-type": "2", "prefix": prefix}
        if token: q["continuation-token"] = token
        root = ET.fromstring(_s3_request(f"/{BUCKET}", q))
        ns = {"s": root.tag.split("}")[0].strip("{")}
        keys += [(c.find("s:Key", ns).text, int(c.find("s:Size", ns).text)) for c in root.findall("s:Contents", ns)]
        if root.find("s:IsTruncated", ns).text == "true":
            token = root.find("s:NextContinuationToken", ns).text
        else:
            return keys


def s3_records(key):
    """객체 하나의 JSONL 레코드 목록(gzip 해제)."""
    body = gzip.decompress(_s3_request(f"/{BUCKET}/{key}"))
    return [json.loads(line) for line in body.decode("utf-8").splitlines() if line.strip()]
