---
description: Jira 티켓을 읽어 /back-skeleton 입력용 스펙 md를 생성한다 — 코드베이스 패턴 조사 + 모호점 질의 후 back/docs/skeleton/ 에 작성
argument-hint: "<티켓번호, e.g. GROMO-297 또는 297>"
allowed-tools: Bash, Read, Grep, Glob, Write, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__getAccessibleAtlassianResources
---

티켓 **$ARGUMENTS** 의 구현 스펙 문서를 만든다.

## 목적

이 커맨드는 **코드를 구현하지 않는다**. Jira 티켓 + 코드베이스 패턴을 종합해
`/back-skeleton` 이 그대로 소비할 수 있는 **스펙 md** 한 장을 만들어
`back/docs/skeleton/<type>-<slug>.md` 에 저장하는 게 전부다.

파이프라인: `/jira-impl GROMO-297` → 스펙 md → `/back-skeleton <type>-<slug>` → 골격 → 사용자가 구현.

## 실행 흐름

### 1. 티켓 번호 정규화
`$ARGUMENTS` 에서 티켓 키를 뽑는다. 숫자만(`297`) 들어오면 `GROMO-297` 로 보정한다.
인자가 없으면 중단하고 티켓 번호를 요청한다.

### 2. 티켓 조회
`mcp__atlassian__getJiraIssue` 로 티켓을 읽는다.
- cloudId: `6a621419-d0b3-4b78-8812-bd8bc49305dc` (romance.atlassian.net).
  실패하면 `mcp__atlassian__getAccessibleAtlassianResources` 로 cloudId 를 재확인한다.
- `fields`: `["summary","description","status","issuetype","labels","parent"]`,
  `responseContentFormat: "markdown"`.
- 요약·설명·부모 에픽을 파악한다. 설명에 `PRD N-N` 참조가 있으면
  팀 공유 `docs/prd/<기능>/` 또는 개인 스크래치 `.docs/superpowers/specs/` 의
  관련 PRD/설계 문서도 찾아 읽는다.

조회 실패(권한/404) 시 중단하고 사용자에게 알린다. **추측으로 진행하지 않는다.**

### 3. 코드베이스 패턴 조사
티켓이 건드릴 도메인을 추정해 `back/src/main/java/com/oneorthree/phone/<domain>/` 아래
기존 `api/`·`service/`·`domain/`·`repository/`·`dto/`·`exception/` 를 읽는다.
- 비슷한 엔드포인트/엔티티/DTO/에러코드를 찾아 **따라야 할 패턴**을 확정한다
  (메서드 시그니처, `@Transactional` 위치, 예외 처리 방식, DTO 클래스/record 스타일 등).
- `back/docs/db/schema.dbml` 을 확인해 **필요한 컬럼·테이블이 이미 있는지** 본다
  → 있으면 migration 불필요, 없으면 Flyway `V<N+1>__<desc>.sql` 항목을 스펙에 포함
  (`back/src/main/resources/db/migration/`, 버전은 기존 파일의 숫자 max+1).
- Serena 심볼 도구가 있으면 호출 경로 추적에 활용한다.

### 4. 모호점 질의 (중요)
티켓·코드만으로 정해지지 않는 **실제 설계 결정**이 있으면 `AskUserQuestion` 으로
하나씩 묻는다. 가능하면 객관식 + 추천안 우선. 전형적 모호점:
- URL 경로/HTTP 메서드 컨벤션이 코드베이스에 섞여 있을 때 (`/user` vs `/users/me`).
- 검증 규칙(필수/길이 상한), 멱등성, 권한·게스트 허용 여부.
- 단일 티켓이 여러 커밋으로 쪼개지는지.
명백한 건 묻지 말고 컨벤션 기본값을 따른다. **코드베이스에 답이 있으면 직접 확인한다.**

### 5. 설계안 제시 → 승인
조사·질의 결과를 짧은 설계안으로 요약해 제시한다(엔드포인트, 생성/수정 파일,
에러, 스코프 제외, DB 변경 여부). **사용자 승인 전에는 파일을 쓰지 않는다.**

### 6. 스펙 md 작성
승인되면 `back/docs/skeleton/<type>-<slug>.md` 에 아래 형식으로 저장한다.
- `<type>`: 백엔드 작업이므로 b- prefix 규칙(`bfeat`/`bfix`/`brefactor`/`bchore`)에서 티켓 성격에 맞게.
- `<slug>`: 기능을 나타내는 케밥케이스 (예: `device-token`).

```markdown
# <기능명 한 줄>

## 커밋 순서
1. GROMO-XXX: <한 줄 설명>

## GROMO-XXX: <티켓 제목>

### 개요
- 엔드포인트: `<METHOD> /api/v1/...` → <성공 코드>
- 인증: <필요 여부 / JwtFilter 화이트리스트 영향>
- 따라갈 패턴: `<참고 파일 경로>`

### 신규 파일
- `<domain>/dto/FooRequest.java` — <목적, 검증 규칙>
- `<domain>/api/FooControllerTest.java` — <검증할 케이스>

### 기존 파일 수정
- `<domain>/api/FooController.java` — <추가할 메서드 시그니처>
- `<domain>/service/FooService.java` — <추가할 메서드, 예외 처리>

### migration
- 불필요 (컬럼 이미 존재) — 또는 `back/src/main/resources/db/migration/V<N+1>__<desc>.sql` — <변경 내용>

### 에러
- 400/401/404 ... — <조건 / 에러코드>

### 스코프 제외 (YAGNI)
- <이번 티켓에서 안 하는 것 + 어느 티켓 범위인지>
```

기존 `back/docs/skeleton/*.md` 가 있으면 그 형식·톤을 우선해 맞춘다.

### 7. 다음 단계 안내
작성한 파일 경로를 출력하고, 이어서 실행할 명령을 안내한다:
```
✅ 스펙 작성: back/docs/skeleton/<type>-<slug>.md
다음: /back-skeleton <type>-<slug>  (골격 생성) 또는 직접 구현
```

---

## 주의사항
- **코드를 구현하지 않는다.** 산출물은 스펙 md 한 장뿐.
- 티켓 조회·승인이 안 되면 추측으로 진행하지 말고 중단한다.
- 설명은 한국어, 코드 식별자는 영어 (프로젝트 컨벤션).
- DB 컬럼이 이미 있으면 migration 항목을 넣지 말 것 — schema.dbml 로 반드시 확인.
