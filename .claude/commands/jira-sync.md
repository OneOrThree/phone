---
description: PRD 문서를 읽어 Jira Task 티켓을 일괄 생성한다. 생성 전 목록을 확인하고 승인 후 실행.
argument-hint: "[PRD 파일 경로] [--label BE] [--release 0.0.4]"
allowed-tools: Bash, Read, Glob
---

PRD 기반 Jira 티켓 자동 생성: **$ARGUMENTS**

## 실행 흐름

### 1. 인자 파싱
`$ARGUMENTS`에서 다음을 파싱한다:
- PRD 파일 경로 (없으면 팀 공유 `docs/prd/*/prd.md` → 개인 스크래치 `.docs/superpowers/specs/`의 최근 `*-prd.md`/`*-sprint*-prd.md` 순으로 자동 선택)
- `--label <값>` → 기본값 `BE`
- `--release <값>` → 기본값 `0.0.4`

### 2. 환경변수 확인
아래 환경변수가 모두 설정돼 있는지 확인한다 (`.claude/settings.local.json`에 저장됨):
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_BASE_URL`
- `JIRA_PROJECT_KEY`

없으면 에러 메시지 출력 후 중단:
```
❌ Jira 크리덴셜이 없습니다.
.claude/settings.local.json 의 env 섹션에 JIRA_EMAIL, JIRA_API_TOKEN, JIRA_BASE_URL, JIRA_PROJECT_KEY를 추가해주세요.
```

### 3. Jira 메타데이터 조회
다음을 Bash(python3)로 조회한다:
- 이슈 타입 목록 → `작업`의 ID 추출
- 버전 목록 → `--release` 인자에 해당하는 버전 ID 추출
- 라벨 목록 → `--label` 라벨이 존재하는지 확인

버전이 없으면:
```
❌ 릴리즈 버전 '{release}'이 GROMO 프로젝트에 없습니다. romance.atlassian.net에서 버전을 먼저 생성해주세요.
```

### 4. PRD 파싱 — 티켓 후보 추출
PRD 파일을 Read로 읽은 뒤 다음 규칙으로 티켓 후보를 추출한다:

**추출 기준 (우선순위 순)**
1. 각 섹션 제목(H3 `### N-N.`) 아래에 있는 HTTP 메서드 + 경로 패턴 (`GET/POST/PATCH/DELETE/PUT /api/...` 또는 `STOMP 채널`)을 가진 항목
2. DB 마이그레이션 섹션 (`## 5.` 또는 `마이그레이션` 키워드)이 있으면 단일 티켓으로 묶음
3. 인프라/설정 항목 (APNs, Redis, 스케줄러 등)이 독립 섹션으로 있으면 포함

**티켓 제목 포맷**: `동사형 한줄 설명` — **대괄호 접두를 붙이지 않는다**
- 도메인은 제목이 아니라 `도메인` 필드가 담는다 (`docs/jira-conventions.md`)
- 동사: 구현 / 조회 API 구현 / 설정 API 구현 / 마이그레이션 / 연동

**도메인**(필수): PRD 섹션에 맞는 값을 `도메인` 드롭다운에서 고른다.
옵션은 아래 스크립트가 지라에서 조회한다 — 목록을 여기 하드코딩하지 않는다(늘어난다).

**티켓 설명**: 해당 PRD 섹션의 핵심 내용 (엔드포인트, 비즈니스 로직 요약, 에러 케이스, 참고 섹션 번호)

### 5. 목록 출력 및 확인 요청
추출된 티켓 후보를 번호와 함께 출력한다:

```
📋 생성 예정 Jira 티켓 (라벨: BE | 릴리즈: 0.0.4 | 이슈타입: 작업)
   ※ 도메인은 티켓마다 개별 지정 — 비면 생성하지 않는다
──────────────────────────────────────────
 1. 애플 로그인 API 구현            [도메인: 인증·계정]
 2. 게스트 로그인 API 구현          [도메인: 인증·계정]
 ...
──────────────────────────────────────────
총 N개

전체 생성할까요? (특정 번호만 제외하려면 "1,3 제외" 또는 "전부" 입력)
```

사용자의 응답을 기다린다. "전부" 또는 "ㅇ" / "응" / "yes" → 전체 생성. "X 제외" → 해당 번호 제외 후 생성. "취소" → 중단.

### 6. 티켓 일괄 생성
승인된 티켓을 아래 Python 스크립트로 생성한다:

```python
import requests, time, os

auth   = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])
base   = os.environ["JIRA_BASE_URL"] + "/rest/api/3"
label  = LABEL   # 파싱된 값
ver_id = VERSION_ID  # 조회된 버전 ID
type_id = TASK_TYPE_ID  # 조회된 작업 이슈타입 ID

# 도메인 필드(필수) — 옵션 id 는 지라에서 조회한다. 규약: docs/jira-conventions.md
DOMAIN_FIELD = "customfield_10342"
_ctx = requests.get(f"{base}/field/{DOMAIN_FIELD}/context", auth=auth).json()["values"][0]["id"]
DOMAIN_OPTS = {o["value"]: o["id"] for o in requests.get(
    f"{base}/field/{DOMAIN_FIELD}/context/{_ctx}/option", auth=auth).json()["values"]}
# Component 미러는 오너 스윕이 맞춘다 — 여기서 넣지 않는다

def adf(text):
    return {"version":1,"type":"doc","content":[
        {"type":"paragraph","content":[{"type":"text","text":text}]}]}

def create(summary, desc, domain):
    assert domain in DOMAIN_OPTS, f"도메인 '{domain}' 이 옵션에 없다: {sorted(DOMAIN_OPTS)}"
    r = requests.post(f"{base}/issue", auth=auth, json={"fields":{
        "project":      {"key": os.environ["JIRA_PROJECT_KEY"]},
        "issuetype":    {"id": type_id},
        "summary":      summary,          # 대괄호 접두 없음
        "description":  adf(desc),
        "labels":       [label],
        "fixVersions":  [{"id": ver_id}],
        DOMAIN_FIELD:   {"id": DOMAIN_OPTS[domain]},
    }})
    d = r.json()
    return d.get("key"), r.status_code

ok, fail = 0, 0
for summary, desc in TICKETS:
    key, status = create(summary, desc)
    if key and key.startswith(os.environ["JIRA_PROJECT_KEY"]):
        print(f"  ✅ {key}  {summary}")
        ok += 1
    else:
        print(f"  ❌ [{status}] {summary}")
        fail += 1
    time.sleep(0.3)

print(f"\n완료: {ok}/{ok+fail}  |  실패: {fail}")
```

### 7. 결과 요약
```
✅ 생성 완료: N개 (GROMO-XXX ~ GROMO-YYY)
🔗 https://romance.atlassian.net/jira/software/projects/GROMO/boards
```

---

## 주의사항
- 이미 같은 제목의 티켓이 있는지 확인하지 않음 → 중복 생성 주의. 같은 PRD로 두 번 실행하지 말 것.
- `--release` 버전이 Jira에 없으면 사전에 `romance.atlassian.net`에서 생성 필요.
- 크리덴셜은 `.claude/settings.local.json`에 저장 (gitignore 포함, 커밋되지 않음).
- API 토큰 갱신 시 `settings.local.json`의 `JIRA_API_TOKEN` 값만 교체.
