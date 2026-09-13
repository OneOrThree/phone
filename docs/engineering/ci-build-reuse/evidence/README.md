# 검증 증거 재확인

이 디렉터리의 JSON 경로는 이 디렉터리를 기준으로 해석한다. `/tmp`나 작업 머신의 로그가 없어도 저장소에 포함된 파일로 재확인할 수 있다.

- [archived-logs.json](archived-logs.json): 로컬 CI, 원격 Actions, 스택 검증의 원본 로그 55개를 gzip으로 보관한다. 압축 파일과 압축 해제한 원문 각각의 SHA-256을 기록했다. 기존 증거 JSON의 로그 해시는 **압축 해제한 원문**의 해시다.
- [stack-merge-repair.json](stack-merge-repair.json): 서비스별 `log`, `image_log`, `test_results.path`가 저장소 안의 검증 로그·이미지 빌드 로그·JUnit 결과를 가리킨다. 이미지 ID는 보관한 빌드 로그에서도 확인할 수 있다.
- [remote-artifact-proofs.json](remote-artifact-proofs.json): 네 서비스의 `workflow_log`와 `image_log`로 검사→이미지 manifest와 cache export를 재확인한다. GitHub 실행 URL은 원격 실행의 출처다.
- [data-timeout-evidence.json](data-timeout-evidence.json), [data-final-test-evidence.json](data-final-test-evidence.json): 타임아웃 시도의 일부 결과와 성공한 재실행 결과를 별도 보관한다.

`test-results/*.zip` 7개는 집계용 JUnit XML이다. 테스트 케이스·상태·집계 속성은 유지하고 `system-out`·`system-err`만 제외했다. 각 ZIP의 `source-xml-sha256.json`에는 변환 전 XML의 해시가 있다. 이 ZIP은 GitHub에서 내려받은 원본 아티팩트 ZIP과 다르며, 원본 ZIP 해시와 집계용 ZIP 해시를 구분한다.

저장소 루트에서 다음 명령으로 로그 해시, 집계용 ZIP 해시, 테스트 수·실패·오류·생략 수를 다시 확인한다.

```bash
python3 - <<'PY'
import gzip, hashlib, json, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path('docs/engineering/ci-build-reuse/evidence')
sha = lambda data: hashlib.sha256(data).hexdigest()
for entry in json.loads((root / 'archived-logs.json').read_text()):
    raw = (root / entry['path']).read_bytes()
    assert sha(raw) == entry['archive_sha256']
    assert sha(gzip.decompress(raw)) == entry['uncompressed_sha256']

def verify(value):
    if isinstance(value, dict):
        if str(value.get('path', '')).startswith('test-results/'):
            path = root / value['path']
            assert sha(path.read_bytes()) == value['sha256']
            with zipfile.ZipFile(path) as archive:
                suites = [ET.fromstring(archive.read(name))
                          for name in archive.namelist() if name.endswith('.xml')]
            counts = {key: sum(int(suite.get(key, 0)) for suite in suites)
                      for key in ('tests', 'failures', 'errors', 'skipped')}
            assert counts == value['counts']
            assert sum(len(suite.findall('testcase')) for suite in suites) == counts['tests']
            print(path.name, counts)
        for child in value.values():
            verify(child)
    elif isinstance(value, list):
        for child in value:
            verify(child)

for path in root.glob('*.json'):
    verify(json.loads(path.read_text()))
print('PASS: 보관 로그 해시와 JUnit 집계 일치')
PY
```

원본 로그는 `gzip -dc docs/engineering/ci-build-reuse/evidence/logs/<파일명>.log.gz`로 읽을 수 있다. gzip은 로그 바이트를 바꾸지 않으며, JUnit 출력 제외와는 별도 처리다.
