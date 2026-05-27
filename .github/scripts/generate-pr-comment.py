import os, json, glob
import xml.etree.ElementTree as ET

run_url = os.environ['RUN_URL']
cs_result = os.environ['CHECKSTYLE_RESULT']
sb_result = os.environ['SPOTBUGS_RESULT']
ts_result = os.environ['TEST_RESULT']
build_result = os.environ.get('BUILD_RESULT', 'skipped')

passed = failed = skipped = 0
for xml_file in glob.glob('test-results/**/*.xml', recursive=True):
    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()
        suites = [root] if root.tag == 'testsuite' else root.findall('testsuite')
        for suite in suites:
            t = int(suite.get('tests', 0))
            f = int(suite.get('failures', 0)) + int(suite.get('errors', 0))
            s = int(suite.get('skipped', 0))
            passed += t - f - s
            failed += f
            skipped += s
    except Exception:
        pass

def parse_jacoco(path):
    if not os.path.exists(path):
        return None, None
    try:
        tree = ET.parse(path)
        root = tree.getroot()
        line = branch = None
        for counter in root.iter('counter'):
            missed = int(counter.get('missed', 0))
            covered = int(counter.get('covered', 0))
            total = missed + covered
            if total == 0:
                continue
            pct = covered / total * 100
            if counter.get('type') == 'LINE':
                line = pct
            elif counter.get('type') == 'BRANCH':
                branch = pct
        return line, branch
    except Exception:
        return None, None

curr_line, curr_branch = parse_jacoco('coverage/jacocoTestReport.xml')
base_line, base_branch = parse_jacoco('coverage-baseline/jacocoTestReport.xml')

def fmt_row(curr, base):
    curr_s = f'{curr:.1f}%' if curr is not None else 'N/A'
    base_s = f'{base:.1f}%' if base is not None else 'N/A'
    if curr is not None and base is not None:
        diff = curr - base
        arrow = '▲' if diff >= 0 else '▼'
        diff_s = f'{arrow} {diff:+.1f}%'
    else:
        diff_s = '—'
    return base_s, curr_s, diff_s

base_l, curr_l, diff_l = fmt_row(curr_line, base_line)
base_b, curr_b, diff_b = fmt_row(curr_branch, base_branch)

jar_size = 'N/A'
jar_path = 'jar-size/jar-size.txt'
if os.path.exists(jar_path):
    try:
        with open(jar_path) as f:
            bytes_val = int(f.read().strip())
            jar_size = f'{bytes_val / 1024 / 1024:.1f} MB'
    except Exception:
        pass

high_cve = medium_cve = low_cve = 0
owasp_status = '✅ 0 CVE'
owasp_path = 'owasp/dependency-check-report.json'
if os.path.exists(owasp_path):
    try:
        with open(owasp_path) as f:
            data = json.load(f)
        for dep in data.get('dependencies', []):
            for vuln in dep.get('vulnerabilities', []):
                sev = vuln.get('severity', '').upper()
                if sev in ('CRITICAL', 'HIGH'):
                    high_cve += 1
                elif sev == 'MEDIUM':
                    medium_cve += 1
                else:
                    low_cve += 1
        if high_cve > 0 or medium_cve > 0:
            owasp_status = f'⚠️ High: {high_cve}, Medium: {medium_cve}, Low: {low_cve}'
    except Exception:
        owasp_status = '⚠️ 리포트 파싱 실패'

def icon(result):
    return '✅' if result == 'success' else '❌'

overall = '✅' if all(r == 'success' for r in [cs_result, sb_result, ts_result, build_result]) else '❌'

comment = f"""## CI Report {overall}

| Job | 결과 |
|-----|------|
| Checkstyle | {icon(cs_result)} |
| SpotBugs | {icon(sb_result)} |
| Test | {icon(ts_result)} |
| Build | {icon(build_result)} |

### 테스트 결과
| 상태 | 건수 |
|------|------|
| ✅ 통과 | {passed} |
| ❌ 실패 | {failed} |
| ⏭️ 스킵 | {skipped} |

### 커버리지 변화 (main 대비)
| 항목 | main | PR | 변화 |
|------|------|----|------|
| Line | {base_l} | {curr_l} | {diff_l} |
| Branch | {base_b} | {curr_b} | {diff_b} |

### JAR 크기
| | 크기 |
|--|------|
| PR | {jar_size} |

### 보안 스캔 요약
| 도구 | 결과 |
|------|------|
| SpotBugs | {icon(sb_result)} (HIGH 이상 기준) |
| OWASP Dep Check | {owasp_status} |

---
*[워크플로우 실행 보기]({run_url})*
"""

with open('pr-comment.md', 'w') as f:
    f.write(comment)
