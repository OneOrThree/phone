# Git · PR 규약

브랜치·커밋·PR 제목·본문·담당자·라벨·리뷰·머지에 대한 **단일 정본**이다. 2026-09-15 에 최근 머지
60건의 실태(담당자=작성자 59건 · 라벨 정확히 1개 59건 · draft 0건)를 그대로 규칙으로 적었다.
루트 `CLAUDE.md` 와 `.claude/pr-gate.py` 훅은 이 문서를 가리키고, 어긋나면 이 문서가 맞다.

## 1. 브랜치

```
<area><type>/GROMO-####-<kebab-slug>
```

| `<area>` | 범위 | 예 |
| --- | --- | --- |
| `b` | `server/**` 전체 — data-api · realtime · business-api · notification | `bfeat/GROMO-1762-chat-auth` |
| `a` | `app/**` | `afix/GROMO-1637-focus-shield` |
| (없음) | 횡단 — `.github/` · 루트 스크립트 · `.claude/` · 여러 영역 동시 | `chore/GROMO-1885-conventions-and-gates` |
| `doc/` | `docs/**` 만 | `doc/GROMO-1740-readme-overhaul` (신규 PRD 는 `doc/prd-<기능>`, 수정은 `doc/fix-prd-<기능>`) |

`<type>` ∈ `feat` · `fix` · `refactor` · `chore`. 슬러그는 영문 kebab-case, 티켓 키는 대문자.

- **코딩 전에 브랜치를 만든다.** `main` 에서 편집하지 않는다. `main` 은 통합 브랜치, `release` 는 배포 브랜치다.
- 새 브랜치는 **만드는 즉시 origin 에 push** 한다 (Claude Code 는 `.claude/settings.json` 훅이 자동으로 한다. 안 됐으면 `git push -u origin <branch>`).
- 스쿼시 머지라 스택 브랜치는 부모가 머지되면 충돌한다. 형제 PR 과 겹치면 `git merge origin/main` 머지 커밋으로 풀고 force push 는 쓰지 않는다.

## 2. 커밋 · PR 제목

```
[TYPE] GROMO-#### 한 줄 요약
```

- `TYPE` ∈ `FEAT` · `FIX` · `CHORE` · `REFACTOR` — **4종 고정**. `[DOC]`, `[GROMO-####]`, `[GROMO-1/GROMO-2]` 같은 대체 표기는 쓰지 않는다. 문서 PR 은 `[CHORE]`.
- 스쿼시 머지라 **PR 제목이 곧 main 커밋 메시지**다. 잡일도 티켓 키가 필요하다 — 없으면 티켓부터 만든다 (`jira-ticket-template.md`).
- 한국어로 쓴다. 본문은 「무엇」보다 **「왜」**, 특히 판단이 갈렸던 지점.

## 3. PR 본문

`.github/pull_request_template.md` 의 섹션 8개를 **이름 그대로** 쓴다:

| 섹션 | 언제 |
| --- | --- |
| `## Jira` | 항상 — `- [GROMO-####](https://romance.atlassian.net/browse/GROMO-####)` |
| `## 변경 유형` | 항상 — FEAT / FIX / CHORE / REFACTOR |
| `## Summary` | 항상 — 무엇을 왜, 2~3줄 |
| `## 커밋 목록` | 항상 — `git log origin/main..HEAD --oneline` |
| `## Changes` | 항상 |
| `## 빌드/배포 영향` | `app/**` 변경이 있을 때만 (없으면 삭제) |
| `## DB 변경 (백엔드)` | 스키마 변경이 있을 때만 (없으면 삭제) — 마이그레이션 파일과 `schema.dbml` 을 같이 적는다 |
| `## 주의사항` | 리뷰어가 알아야 할 것이 있을 때만 (없으면 삭제) |

- Jira 링크 호스트는 `romance.atlassian.net` 이다.
- **claude.ai 세션 링크를 넣지 않는다.**

## 4. 티켓 참조

Jira 연동은 `GROMO-####` **전체 키**를 보고 PR 이력을 그 티켓에 붙인다. 그래서:

- 이 PR 이 **구현하는 티켓 하나만** 전체 키로 쓴다 (제목 + `## Jira`).
- 관련·참조 티켓은 **번호만** 쓴다 — 「티켓 455 에서 결정」. 전체 키를 쓰면 그 티켓에 엉뚱한 PR 이 붙는다.

## 5. 메타데이터 — 담당자 · 라벨 · draft

| 항목 | 규칙 |
| --- | --- |
| 담당자 | **PR 작성자 본인** (`gh pr create --assignee @me`) |
| 라벨 | **정확히 1개**, 기존 라벨만. 새 라벨을 만들지 않는다 |
| reviewer | 지정하지 않는다 — 리뷰 봇이 스스로 붙는다 |
| draft | **쓰지 않는다** — codex 자동 리뷰는 ready PR 에만 붙는다. draft 로 열면 리뷰 0건으로 방치된다 |

라벨은 제목의 `TYPE` 에서 결정한다:

| TYPE | 라벨 |
| --- | --- |
| `FEAT` | `enhancement` |
| `FIX` | `bug` |
| `REFACTOR` | `refactoring` |
| `CHORE` | **내용으로 택1** — `docs/**` 만 → `documentation` · CI·워크플로·스크립트·훅 → `workflow` · 테스트만 → `test` · 그 외 → 라벨 없음 |

`release:*` 라벨은 릴리스 자동화용이라 PR 에 붙이지 않는다.

한 줄로:

```bash
gh pr create --assignee @me --label <라벨> --title "[TYPE] GROMO-#### 요약" --body-file body.md
```

Claude Code 에서는 `.claude/pr-gate.py` 훅이 위 규칙을 어긴 `gh pr create` 를 거부한다 (사유를 돌려주고, 사용자 확인창은 뜨지 않는다).

## 6. 리뷰 루프

- PR 을 열자마자 **`@claude` 리뷰 요청 코멘트**를 단다 — 이 PR 에 맞춘 리뷰 포인트 3~5개. 답글·기록 코멘트에는 `@claude` 를 쓰지 않는다 (워크플로가 다시 돈다).
- **codex**(`chatgpt-codex-connector`)는 부르지 않아도 ready PR 에 붙고, **push 마다 새 라운드**를 돈다. `@codex` 를 따로 부르지 않는다.
- 지적은 성격으로 처리한다 — 라운드 수로 자르지 않는다:

| 지적 | 처리 |
| --- | --- |
| P1 · 동작이 깨짐 · 데이터 손실 · 계약 파괴 | 즉시 고친다 |
| P2 인데 **이 PR 자신의 계약**과 모순 (표가 본문과 다름 등) | 즉시 고친다 |
| 그 외 P2 | 스레드에 판단을 답글로 남기고 후속 티켓으로 뺀다. **push 하지 않는다** — push 가 다음 라운드를 부른다 |

- 지적을 반영하기 전에 **그 동작에 기대고 있던 것**부터 찾는다. 「막는다」가 아니라 「좁힌다」로 푼다.
- codex 지적 중 가장 흔한 오탐은 「반대편 절반(앱/서버)이 이 PR 에 없다」다. 반박 전에 형제 PR·머지된 트리를 인용해 확인한다.

## 7. 머지 조건

네 가지가 **같은 커밋**에서 동시에 성립해야 한다:

1. 미답변 루트 리뷰 스레드 **0**
2. 리뷰어 판정이 깨끗함 — **최신 head push 이후**의 codex 👍(PR 본문 리액션) 또는 「no major issues」 산문, `@claude` 는 `**Claude finished` 로 시작하는 코멘트의 산문. 오래된 커밋에 대한 판정은 무효
3. CI **전부 통과** — 「실패 0」 ≠ 「전부 통과」. 대기·취소가 남아 있으면 아니다
4. `mergeStateStatus` = `CLEAN`

이 레포엔 정식 APPROVE 가 없다(모든 리뷰가 `COMMENTED`). 「승인받았다」는 표현은 쓰지 않는다.
**머지 버튼은 사람이 누른다.** 에이전트는 네 조건의 상태를 보고할 뿐 머지하지 않는다.
Flyway 마이그레이션 번호 순서 = 머지 순서다 (`out-of-order` 꺼져 있음).

## 8. git 실행 권한 (에이전트)

- `git add` · `commit` · `push` 는 **행동마다** 사용자 승인. 승인은 **하네스 권한 프롬프트**로 받는다 — 채팅에서 「커밋할까요?」 하고 묻지 않는다. 한 번의 승인은 다음 행동으로 이어지지 않는다.
- 예외: 새 브랜치의 **초기 push** 는 브랜치 생성의 일부다 (§1).
- `main` · `release` 에 직접 커밋·push 하지 않는다. force push 는 쓰지 않는다.
- **서버 티켓은 `app/` 을 건드리지 않는다** (반대도 같다). 착수 전 `git diff --name-only origin/main | cut -d/ -f1 | sort -u` 로 최상위 경로를 확인한다.
- 리뷰 계수는 `gh api --paginate` 로 센다 — 30건 초과가 조용히 잘린다.

## 관련 문서

- `.github/pull_request_template.md` — 본문 골격
- `docs/conventions/jira-conventions.md` — 티켓 분류 4축
- `docs/conventions/jira-ticket-template.md` — 티켓 본문 양식과 생성 게이트
- `.claude/pr-gate.py` — `gh pr create` 훅 (Claude Code)
