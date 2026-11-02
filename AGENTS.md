# AGENTS.md

Codex와 그 밖의 코딩 에이전트가 따르는 저장소 규칙이다. 리뷰할 때는 아래 「Code Review Rules」를 따른다.

## 작업 전에 읽는다

- `CLAUDE.md` — 저장소 지도, 금지선(「Hard lines」), Git·Jira·CI 요약. 영어 문서이고 Codex에도 그대로 적용된다.
- `CONTEXT.md` — 용어. 새 문장은 이 말을 쓴다.
- `docs/conventions/git-pr-conventions.md` — 브랜치·커밋·PR·리뷰·머지의 정본.
- `docs/engineering/pipeline-map.md` — 바꾼 경로가 PR·main 머지 뒤·운영에서 무엇을 부르는지.
- 작업 폴더의 `AGENTS.md`(`app/app-dev/`, `app/legacy/app-dev/`, `backoffice/`)가 있으면 그것도 읽는다.

## 금지선

`CLAUDE.md` 「Hard lines」의 여섯 항목이 정본이다. Codex에도 그대로 적용된다.

## Claude Code 훅 없이 지킬 것

Claude Code에서는 `.claude/settings.json`의 훅이 아래 일을 막거나 확인을 받는다. Codex에는 이 훅이 없다. 같은 규칙을 스스로 지킨다.

| Claude Code의 장치 | Codex가 직접 할 일 |
| --- | --- |
| `.claude/pr-gate.py` — 규약을 어긴 `gh pr create`를 거부한다 | PR을 열기 전에 제목·본문·담당자·라벨을 `git-pr-conventions.md` §2~§5와 대조한다 |
| `.claude/prod-impact.py` — 운영에 닿는 편집을 알리고, 운영에 닿는 PR 머지와 운영 CD 재실행 전에 확인을 받는다 | 바꾼 경로를 `pipeline-map.md`의 「운영까지」 열과 대조한다. 운영에 닿으면 PR 머지와 운영 CD 재실행 전에 소유자 확인을 받는다 |
| `permissions.ask` — 운영 워크플로 수동 실행 전에 확인을 받는다 | 소유자가 시킨 배포가 아니면 운영 워크플로를 실행하지 않는다 |
| `.claude/jira_gate.py` — 완료 조건·산출물이 비거나 애매한 티켓을 거부한다 | 티켓을 만들기 전에 `docs/conventions/jira-ticket-template.md` §4 표로 확인한다 |

## Code Review Rules

### main → release 운영 승격

- PR 메타데이터에서 같은 저장소의 head가 `main`, base가 `release`인지 먼저 확인한다. 이 조건이면 일반 코드 리뷰 대신 아래 승격 요약 규칙을 우선 적용한다.
- release 대비 main에 포함된 변경을 확인하여 **「운영 승격 변경 요약」 한국어 댓글 하나**를 남긴다. 사용자 기능·버그 수정·운영 및 설정 변경을 중심으로 쓰고, 근거 PR이나 커밋을 연결한다.
- 요약 댓글에 기준 head SHA를 적고, 같은 SHA의 「운영 승격 변경 요약」이 있으면 중복 작성하지 않는다. head가 바뀌면 본인 댓글을 갱신하고, 다른 작성자의 이전 SHA 댓글만 있으면 새 SHA의 요약 하나를 남겨 최신 기준을 구분한다.
- 승격 요약에는 코드 지적·리팩터링 제안·인라인 리뷰 댓글·심각도 표기를 붙이지 않는다. 확인하지 않은 동작이나 배포 성공을 단정하지 않는다.
- 코드 수정과 코드 리뷰는 main 대상 PR에서 끝낸다. 승격 PR에서는 코드를 더 고치지 않고 CI 결과와 충돌 여부만 확인한다. 병합은 사람이 **Create a merge commit**으로 해서 main 부모 이력을 보존한다. V2 발행(`prod-ci-V2.yml`)은 `release:*` 라벨을 읽지 않고 patch만 올린다.

### 언어

- **모든 리뷰 코멘트·요약·제목은 한국어로 작성한다.** 영어로 쓰지 않는다.
- 코드 식별자, 파일 경로, 로그·에러 메시지 원문은 번역하지 않고 그대로 인용한다.

### 리뷰 범위

- 포맷·임포트 순서·네이밍 스타일은 지적하지 않는다.
  (ESLint·Prettier·Checkstyle·SpotBugs가 CI에서 이미 검사한다)
- 취향에 가까운 리팩터링 제안은 하지 않는다.
- 같은 문제는 한 번만 지적한다. 여러 파일에 반복되면 대표 위치 하나에 모아서 쓴다.

### 심각도 표기

- 코드 리뷰 코멘트 맨 앞에 심각도를 붙인다.
  - `[필수]` — 버그, 데이터 손실, 보안, 런타임 크래시. codex 등급의 P1이다.
  - `[제안]` — 그 외 개선 의견. codex 등급의 P2다.
- 등급별 처리(바로 고칠 것·후속 티켓으로 뺄 것)는 `git-pr-conventions.md` §6을 따른다.
