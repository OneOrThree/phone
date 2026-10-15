---
description: PRD 문서를 읽어 Jira 작업 티켓을 일괄 생성한다 — 후보마다 8요소 양식을 채워 jira_assign.py 로 만든다. 생성 전 목록을 확인하고 승인 후 실행.
argument-hint: "[PRD 파일 경로] [--label BE] [--sprint]"
allowed-tools: Bash, Read, Glob, AskUserQuestion
---

PRD 기반 Jira 티켓 자동 생성: **$ARGUMENTS**

`/jira-assign` 과 **같은 스크립트·같은 양식**을 쓴다. 다른 점은 입력이 PRD 한 장이고, 담당자 기본이 본인이며,
기본으로 스프린트에 넣지 않는다(백로그)는 것뿐이다.

## 실행 흐름

### 1. 인자 파싱
- PRD 파일 경로 (없으면 팀 공유 `docs/prd/*/prd.md` → 개인 스크래치 `doc/` 의 최근 `*-prd.md` 순으로 자동 선택)
- `--label <값>` → 선택. 플랫폼이 명확할 때만 (`BE` · `App` · `iOS` · `Android` · `Infra`)
- fixVersion 은 **생성 시 넣지 않는다** — 미완료 티켓은 비워 두고 완료 처리 때 붙인다 (`jira-conventions.md` §4)
- `--sprint` → 현재 활성 스프린트에 넣는다. 없으면 백로그

### 2. 메타데이터 조회 — 분류보다 먼저
```bash
python3 .claude/jira_assign.py meta
```
`도메인` 옵션 · 열린 에픽 · 활성 스프린트를 준다. **분류는 이 출력 안의 값으로만 한다** —
옵션은 늘고 줄고 개명된다. 크리덴셜이 없으면 스크립트가 `.claude/settings.local.json` 의 `env` 를 안내한다.

### 3. PRD 파싱 — 티켓 후보 추출

**추출 기준 (우선순위 순)**
1. 각 섹션 제목(H3 `### N-N.`) 아래의 HTTP 메서드 + 경로(`GET/POST/PATCH/DELETE/PUT /api/...` 또는 STOMP 채널)를 가진 항목
2. DB 마이그레이션 섹션(`## 5.` 또는 `마이그레이션` 키워드)은 단일 티켓으로 묶는다
3. 인프라/설정 항목(APNs · Redis · 스케줄러 등)이 독립 섹션이면 포함

후보마다 **8요소를 PRD 에서 채운다** (`docs/conventions/jira-ticket-template.md`):

| 요소 | PRD 에서 어디를 보나 |
| --- | --- |
| summary | `동사형 한 줄` — 대괄호 접두 없음. 동사: 구현 / 조회 API 구현 / 설정 API 구현 / 마이그레이션 / 연동 |
| goal | 섹션의 비즈니스 목적 한두 줄 |
| dod | **엔드포인트·상태코드·에러 케이스·테이블명**을 그대로 완료 조건으로 — 「`POST /api/x` 가 201 을 반환한다」「`V<N>__x.sql` 로 `t` 테이블이 생긴다」. 이것들이 게이트가 요구하는 구체 토큰이다 |
| refs | `docs/prd/<기능>/prd.md §N-N` · policy.md 결정 번호 |
| deliverable / output_location | 대개 `PR` / `server/data-api — OneOrThree/phone PR` |
| domain | 2단계 목록 안에서. 없으면 **사용자에게 묻는다** — 임의로 고르지 않는다 |
| estimate | 본인 백로그라 선택. 넣으면 SP 가 자동 환산된다 |

### 4. 목록 제시 → 승인
```
📋 생성 예정 (라벨: BE | 스프린트: 없음)
──────────────────────────────────────────
 1. 애플 로그인 API 구현            [도메인: 인증·계정]  완료 조건 3  참고 2
 2. 게스트 로그인 API 구현          [도메인: 인증·계정]  완료 조건 2  참고 1
──────────────────────────────────────────
총 N개 — 전체 생성할까요? ("전부" / "1,3 제외" / "취소")
```
**승인 전에는 생성하지 않는다.**

### 5. 생성
승인분만 payload 로 만들어 실행한다. 스키마는 `.claude/jira_assign.py` 상단 docstring.
스크립트는 `"sprint"` 필드로만 스프린트 편입을 결정한다.

`"sprint"` 값은 `--sprint` 를 받았으면 `true`, 아니면 `false`.

```bash
SCRATCH=$(mktemp -d)                    # 세션 스크래치패드가 있으면 그 경로를 써도 된다
cat > "$SCRATCH/sync.json" <<'JSON'
{ "sprint": false,
  "tickets": [ { "summary": "...", "domain": "...", "goal": "...", "dod": ["..."],
    "deliverable": "PR", "output_location": "...", "refs": ["..."], "labels": ["BE"] } ] }
JSON
python3 .claude/jira_assign.py create "$SCRATCH/sync.json" --dry-run   # 필드 해석만
python3 .claude/jira_assign.py create "$SCRATCH/sync.json"
```

- payload 는 스크래치패드에 쓴다. 레포에 남기지 않는다.
- 스크립트가 막는 것: 없는 도메인 · 대괄호 접두 · **같은 제목의 미완료 티켓** · **양식 미달**(`jira_gate.py` —
  완료 조건 2개 미만/애매 · 산출물 유형·위치 애매). 양식 미달이면 PRD 를 다시 읽어 구체화하고, PRD 에 없는 정보는
  **사용자에게 묻는다** — 지어내지 않는다.

### 6. 결과 요약
```
✅ 생성 완료: N개 (GROMO-XXX ~ GROMO-YYY)
🔗 https://romance.atlassian.net/jira/software/projects/GROMO/boards
```

## 주의사항
- 같은 PRD 로 두 번 실행하면 중복 검색이 막아 준다. 정당한 재발주만 `--allow-dup`.
- 크리덴셜은 `.claude/settings.local.json` (gitignored). 토큰 갱신 시 `JIRA_API_TOKEN` 값만 교체.

## 관련 커맨드
- `/jira-assign` — 사람에게 시키는 지시서 한 건 (담당자·마감·스프린트 기본 채움)
- `/jira-impl` — 이미 있는 티켓을 읽어 내 구현용 스펙 md 로
