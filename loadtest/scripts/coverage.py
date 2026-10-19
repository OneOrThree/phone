#!/usr/bin/env python3
"""공개 OpenAPI 전 operation 을 k6 시나리오 카탈로그와 재대조해 CSV 로 남긴다 (GROMO-2346).

있음 = k6/cases/public.json 의 조회 사례 또는 k6/cases/write.json 의 쓰기 시나리오가 그 operation 을 호출한다.
제외 = 외부 의존성(소셜 IdP·FCM/APNs·링크 제공자·객체 저장소)이라 하네스가 부하를 만들지 않는다.
없음 = 의존성은 없지만 시나리오가 아직 없다(별도 fixture·쓰기 수명주기·정리 필요).
실측 여부는 보지 않는다 — 실행 결과는 survey 보고서 소관이다.

사용: coverage.py [--spec k6/cases/openapi-public.json] [--out docs/public-api-coverage.csv] [--check]
스펙 갱신: coverage.py --refresh http://<business>/v0/api-docs/public  (스냅샷만 덮어쓴다. 부하 아님)
"""
import argparse, csv, json, re, sys, urllib.request
from pathlib import Path

LT = Path(__file__).resolve().parent.parent
METHODS = ('get', 'post', 'put', 'patch', 'delete')
# (정규식 'METHOD /path', 사유) — 위에서부터 첫 일치. 외부 의존성만 넣는다.
EXCLUDE = [
    (r'^POST /auth/sessions$', '소셜 로그인 — 외부 IdP(Apple·Google 등) 의존'),
    (r'^\w+ /(api/v1/)?link-previews', '링크 미리보기 — 외부 사이트 fetch·객체 저장소(썸네일) 의존'),
    (r'^POST /l/match$', '링크 매칭 — 외부 MMP·링크 제공자 의존'),
    (r'^POST /api/v1/(invite-links/claim|groups/\{groupId\}/invite-link)$', '초대 링크 — 외부 링크 제공자 의존(구 /api/v1 표면)'),
    (r'^(PUT|DELETE) /api/v1/users/me/device-token$', '기기 토큰 — 실제 FCM 기기·자격 의존'),
    (r'^PUT /focus-sessions/\{sessionId\}/live-activity$', 'Live Activity — APNs 의존'),
]


def norm(path):
    return re.sub(r'\{[^}]+\}', '{}', path.split('?')[0])


def load_covered():
    covered = {}
    for c in json.loads((LT / 'k6/cases/public.json').read_text()):
        if c['target'] == 'business':
            for p in c['paths']:
                covered.setdefault(('get', norm(p)), []).append(c['id'])
    for c in json.loads((LT / 'k6/cases/write.json').read_text()):
        for op in c['operations']:
            m, p = op.split(' ', 1)
            covered.setdefault((m.lower(), norm(p)), []).append(c['id'])
    # public.json 의 write_journey(focus_lifecycle)는 paths 가 비어 있다 — 호출하는 operation 을 여기 둔다.
    for p in ('/focus-sessions', '/focus-sessions/{id}/pause', '/focus-sessions/{id}/resume', '/focus-sessions/{id}/finish'):
        covered[('post', norm(p))] = ['focus_lifecycle']
    return covered


def classify(method, path, cases):
    if cases:
        return '있음', ''
    key = f'{method.upper()} {path}'
    for pattern, reason in EXCLUDE:
        if re.search(pattern, key):
            return '제외', reason
    if path.startswith('/auth') or (method == 'delete' and path == '/me'):
        return '없음', '인증/세션·탈퇴 상태 전이 — 별도 수명주기 fixture 필요'
    if method == 'get':
        return '없음', '조회 fixture(상품·퀘스트·공지·원장 등) 또는 ID 의존 상세 필요'
    return '없음', '별도 쓰기 수명주기·정리(teardown) fixture 필요'


def build(spec):
    covered, rows = load_covered(), []
    for path, ops in spec['paths'].items():
        for method, op in ops.items():
            if method not in METHODS:
                continue
            cases = covered.get((method, norm(path)), [])
            status, reason = classify(method, path, cases)
            rows.append(dict(method=method.upper(), path=path, operationId=op.get('operationId', ''),
                             status=status, cases=','.join(sorted(set(cases))), reason=reason))
    return rows


def render(rows):
    import io
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0]), lineterminator='\n')
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', default=str(LT / 'k6/cases/openapi-public.json'))
    ap.add_argument('--out', default=str(LT / 'docs/public-api-coverage.csv'))
    ap.add_argument('--refresh', help='공개 OpenAPI URL(/v0/api-docs/public) — 스냅샷(--spec)을 덮어쓴다')
    ap.add_argument('--check', action='store_true', help='CSV 가 최신 재대조 결과와 같은지만 확인(다르면 exit 1)')
    a = ap.parse_args()
    if a.refresh:
        data = urllib.request.urlopen(a.refresh, timeout=15).read()
        Path(a.spec).write_bytes(json.dumps(json.loads(data), ensure_ascii=False, indent=2).encode() + b'\n')
    rows = build(json.loads(Path(a.spec).read_text()))
    text = render(rows)
    out = Path(a.out)
    if a.check:
        if not out.exists() or out.read_text() != text:
            print(f'{out} 가 최신이 아닙니다 — make coverage 로 갱신하세요', file=sys.stderr)
            sys.exit(1)
    else:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
    tally = {s: sum(r['status'] == s for r in rows) for s in ('있음', '없음', '제외')}
    print(json.dumps({'operations': len(rows), **tally, 'output': str(out)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
