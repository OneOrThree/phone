# CLAUDE.md

Guidance for Claude Code when working in this repository. This root file applies
everywhere. **Nested `CLAUDE.md` files load automatically** when you work inside a
subtree — see `app/legacy/app-dev/.claude/CLAUDE.md` (동결된 1.x) and `server/data-api/CLAUDE.md`
(backend) for the details of each half. Keep this root file limited to shared,
repo-wide concerns.

## Project overview

**gromo** — a focus-time management + character-customization mobile app.
Users run focus sessions, track screen time, and customize a 2D character with
shop items. Company `oneorthree`. The frozen 1.x app uses iOS bundle id
`com.oneorthree.gromo`; the active 2.0 app uses `com.oneorthree.focuscat` on iOS and Android.

## Monorepo layout

| Path                    | What it is |
| ----------------------- | ---------- |
| `app/app-dev/`          | **활성 2.0 앱**. React Native + Expo frontend (TypeScript), native iOS/Android projects, and local mock product flows. See `app/app-dev/README.md`. |
| `app/legacy/app-dev/`   | **동결된 1.x 앱** (스토어 1.1.0까지). Includes the old native projects and Screen Time extension. See `app/legacy/app-dev/.claude/CLAUDE.md`; do not add 2.0 features here. |
| `app/legacy/assets/`    | 1.x 소스 디자인 에셋 (app icons, character art, videos) — tracked binaries, not bundled app resources (those live in `app/legacy/app-dev/src/assets/`). |
| `app/legacy/scripts/`   | 1.x 로컬 웹 실행 도우미 (`local-web.sh`, `local-web.command`). |
| `server/data-api/`      | Spring Boot 4 + Java 17 + PostgreSQL REST API. See `server/data-api/CLAUDE.md`. |
| `server/realtime/`          | Spring Boot 4 realtime service — WebSocket/STOMP + Redis, its own `gromo_chat` DB. A **separate** Gradle project sharing no code with `data-api`. See `server/realtime/CLAUDE.md`. |
| `server/business-api/` | 공개 파일 링크 미리보기 Spring Boot 서비스. 독립 Gradle·전용 Redis. 실행·API 계약은 `server/business-api/README.md`. |
| `server/observability/` | Prometheus / Grafana / Loki / Datadog configs for the dev observability overlay. See `server/observability/README.md`. |
| `server/scripts/`       | The `docker-compose.*.yml` files (`dev` / `local` / `prod` base + `realtime` / `kafka` / `satellites` / `satellites.data` / `business` / `datadog` / `observability` overlays) and satellite deploy prep. The one-line compose combo per environment, the "empty secret → behaviour" table and log-rotation values live in `server/scripts/README.md` §3–§6. |
| `loadtest/`             | k6 load-testing harness (scenarios, GCP runner terraform, trigger dashboard). See `loadtest/README.md`. |
| `docs/`                 | **Team-shared** docs, tracked in git: `docs/prd/<product>/<feature>/` with PRD, policy, IA, high-level/low-level design, diagrams; repo-wide conventions in `docs/conventions/`. See `docs/README.md`. |
| `.github/workflows/`    | CI/CD pipelines (see below). |

**`docs/` vs `doc/`**: `docs/` is the team-shared, committed documentation space
(`docs/prd/<product>/<feature>/` — PRD · policy · IA · high-level/low-level design · diagrams).
`doc/` is the owner's personal planning scratch (tickets, reports, specs, drafts) —
gitignored, never committed. Team-facing docs go in `docs/`; everything personal
stays in `doc/`.

Gitignored local-only dirs (machine-specific, not in git): `doc/` (personal
planning scratch — tickets, reports, specs), `logs/` (work journals),
`server/data-api/docs/` (local planning scratch, **except `server/data-api/docs/db/`
which is tracked** — schema.dbml), `app/app-dev/.docs/` and `app/legacy/app-dev/.docs/` (app-side personal
planning/design docs).

The frontend and backend share almost no tooling — work in the relevant subtree
and let its nested `CLAUDE.md` guide the specifics.

## Language convention

The whole project works in **Korean**: commit messages, PR text, code comments,
and docs are all Korean. Match this — write code comments and commit/PR text in
Korean. Keep code identifiers (types, functions, variables) in English.

## Git & PR conventions

The canonical rules are `docs/conventions/git-pr-conventions.md` (Korean, team-shared); when
this summary and that file disagree, the file wins. The `.claude/pr-gate.py` PreToolUse hook
rejects a `gh pr create` that breaks them (reason goes back to you, no user prompt).

- **Branch**: `<area><type>/GROMO-####-<kebab-slug>`, type ∈ `feat`/`fix`/`refactor`/`chore`.
  `b` = any `server/**` (data-api, realtime, business-api, notification); `a` = `app/**`; bare
  prefix = cross-cutting (`.github/`, root scripts, `.claude/`); `doc/` = `docs/**` only (new
  PRD `doc/prd-<feature>`, edits `doc/fix-prd-<feature>`). Branch **before the first edit**,
  never work on `main`. A new branch is pushed to origin the moment it is created — the
  `.claude/settings.json` PostToolUse hook does it on `checkout -b`/`switch -c`; verify with
  `git ls-remote` and push `-u` yourself if it did not land.
- **Commit / PR title**: `[TYPE] GROMO-#### 한 줄 요약` — TYPE ∈ `FEAT`/`FIX`/`CHORE`/`REFACTOR`,
  exactly those four. `[DOC]` or a ticket key in place of TYPE is not allowed; docs PRs are
  `[CHORE]`. Squash merge makes the PR title the `main` commit message.
- **PR body**: the eight sections of `.github/pull_request_template.md`, by name — `## Jira`,
  `## 변경 유형`, `## Summary`, `## 커밋 목록`, `## Changes`, `## 빌드/배포 영향` (app changes
  only), `## DB 변경 (백엔드)` (schema changes only), `## 주의사항`. Jira host is
  `romance.atlassian.net`. Never append a claude.ai session link.
- **Ticket references**: only the ticket the PR implements gets the full key (`GROMO-####`) —
  the Jira integration attaches PR history to every full key it sees. Reference tickets are
  the number only ("ticket 455").
- **Opening a PR**: `gh pr create --assignee @me --label <one> --title "..." --body-file ...` —
  **never `--draft`**, `--fill` or `--web` (codex auto-review attaches to ready PRs only; the
  gate needs an explicit title and body). Exactly one existing label matching the TYPE:
  FEAT→`enhancement`, FIX→`bug`, REFACTOR→`refactoring`, CHORE→by content (`documentation`
  docs-only, `workflow` CI/scripts/hooks, `test` tests-only, else no label). Never `release:*`,
  never create labels, no `--reviewer`. In the same turn post an `@claude`
  review-request comment with 3–5 PR-specific points and keep watching the PR; later replies
  never mention `@claude` (it re-triggers the workflow).
- **Merge**: four-part test at the same commit — zero unanswered root review threads; a
  reviewer verdict newer than the head push (codex 👍 / "no major issues", or a
  `**Claude finished` comment); CI **all passed** (not merely zero failures);
  `mergeStateStatus` CLEAN. There is no formal APPROVE in this repo. **A human clicks merge**
  — agents report the four states, never merge.
- **git actions**: `git add`, `commit`, `push` need the user's approval **per action**, given
  through the harness permission prompt — do not pre-ask in chat. One approval never carries
  to the next action. Exception: the initial push of a just-created branch (part of branch
  creation). Never commit or push to `main`/`release`; never force-push.
- **Scope**: a server ticket never touches `app/`, and vice versa. Before starting, check the
  top-level paths with `git diff --name-only origin/main | cut -d/ -f1 | sort -u`.

## Creating Jira tickets

- Classification follows `docs/conventions/jira-conventions.md`: exactly one **`도메인`** on
  tasks/bugs/subtasks (a dropdown custom field), none on epics (their `[도메인]` name prefix
  plays that role), Epic only for time-boxed initiatives, no `[Tag]` prefixes in summaries.
- The body follows `docs/conventions/jira-ticket-template.md` (🎯 목표 · ✅ 완료 조건 · 📎 참고
  자료 · 📦 산출물 · ⏱ 예상 작업 시간). `.claude/jira_gate.py` — used by `jira_assign.py` and
  by the PreToolUse hook on `createJiraIssue` — rejects a ticket whose 산출물 or 완료 조건 is
  missing or vague. When rejected, **ask the user for the missing pieces (AskUserQuestion,
  batched) — never invent them.** Epics are exempt.
- Create through `/jira-assign` (one work order) or `/jira-sync` (a PRD at once); both run
  `.claude/jira_assign.py`. Search for duplicates first (JQL + open PRs). Never reassign
  someone else's ticket to yourself — open a new one and link it in a comment.

## CI/CD (`.github/workflows/`)

Pipelines are path-filtered — `app/app-dev/**` changes and `server/data-api/**`
changes trigger different jobs. This list rots; the authoritative source is
`ls .github/workflows/` plus each file's `name:`.

- **App**: `app-lint.yml` — ESLint + Prettier + tsc + jest on `app/app-dev/**`;
  `app-android-build.yml` — Android build checks on native-affecting paths.
  활성 2.0 앱은 이 두 워크플로가 검증한다. ⚠️ **동결된 1.x 앱(`app/legacy/app-dev/**`)에는
  CI가 없다.** 1.x 핫픽스는 CI가
  검증해 주지 않으므로 `app/legacy/app-dev` 에서 `npm ci && npm run lint && npm run format:check
  && npm run typecheck && npm test && npm run gen:palette:check` 를 직접 돌려야 한다.
  마지막 `gen:palette:check` 가 빠지면 `theme.ts` 를 고치고 코드젠을 안 돌렸을 때 나머지가 전부
  통과해도 `ios/Shared/Palette.swift` 가 옛 색으로 남는다 — 종전에는 `app-lint.yml` 이 잡아줬다.
  **Android(XML·Kotlin·Gradle) 핫픽스는 여기에 더해** `app-android-build.yml` 이 하던 XML 정합 검사와
  `(cd android && ./gradlew :app:compileDebugJavaWithJavac)` 를 직접 돌린다 — 위 명령은 전부 통과해도
  네이티브는 컴파일되지 않을 수 있다. 절차는 `app/legacy/app-dev/README.md` 상단에 있다.
- **Business API · Notification**: `satellite-ci.yml` — `server/business-api/**` ·
  `server/notification/**` 매트릭스로 독립 Gradle build(Checkstyle·SpotBugs·Testcontainers 통합
  테스트)와 Docker 이미지 빌드. main push에서만 GAR, release push에서만 ECR 게시. 수동 dev overlay는
  `docker-compose.business.yml`.
- **Shared backend gate**: `be-gradle.yml` — the one reusable (`workflow_call`) workflow for JVM
  Gradle checks. Takes `service` / `runs-on` / `tasks` / `artifact-name` / `artifact-path` /
  `measure-jar`, and isolates `GRADLE_USER_HOME` per service. It starts **no database** — every
  service's tests bring their own via Testcontainers (GROMO-1793 verified data-api's 2,152 tests
  pass with the datasource pointed at a dead port). `runs-on` takes a **JSON array string**
  (`'["ubuntu-latest"]'`) unpacked with `fromJSON`; its default is `'["ubuntu-latest"]'` (GROMO-2121 — the one
  remaining self-hosted `ci` runner is reserved for push-time image publishing).
  **Callers today are exactly two**: `dev-ci.yml` (`service: data-api`) and `realtime-ci.yml`
  (`service: realtime`). `satellite-ci.yml` (business-api + notification) is a deliberate
  **exception** — business-api's PDF-preview tests need `poppler-utils`, installed by the `test`
  stage of its Dockerfile, so that matrix keeps its own container-based build; don't "simplify" it
  into a caller without removing that dependency first.
- **Realtime**: `realtime-ci.yml` — calls `be-gradle.yml` with `service: realtime` (one
  `./gradlew build` covers Checkstyle + SpotBugs + Testcontainers tests + bootJar), plus a
  no-push Docker build, path-filtered to `server/realtime/**`.
- **Backend PR gate + dev deploy**: `dev-ci.yml` calls `be-gradle.yml` three times
  (Checkstyle / SpotBugs / tests) on `server/data-api/**`.
  On PRs it also build-verifies the Docker image (no push); on `main` push the same
  run pushes `back:<sha>` to GAR and calls the reusable `dev-cd.yml` with the image
  digest, which deploys to the GCP dev VM (`gromo-dev-app`, e2-standard-2 — 2 vCPU · 8 GB,
  asia-northeast3-a; see `docs/architecture/decisions.md` A25) on the
  self-hosted `dev` runner — AWS is touched only for OIDC → Secrets Manager `gromo/dev/env`
  (`dev-cd.yml` has no trigger of its own).
- **Prod**: `prod-ci.yml` (verifies PRs to `release`; builds + pushes the image on
  `release` push) → `prod-cd.yml` (auto-deploys via `workflow_run`, or manual
  dispatch by SHA) → `prod-rollback.yml` (manual rollback).
- **API docs**: `api-dog-generate.yml` (OpenAPI generation on `main`/`release`/
  `bfeat|bfix|brefactor` pushes — `bchore` is excluded), `api-docs-cleanup.yml`
  (cleanup on branch delete — currently a **no-op**: its predicate checks a
  `refs/heads/` prefix that the `delete` event's `ref` never carries, so no
  branch deletion is cleaned and doc dirs accumulate on `gh-pages`; known gap).
- **Observability (manual dispatch)**: `dev-datadog.yml` (Datadog APM toggle),
  `dev-monitor.yml` (Prometheus/Grafana/Loki stack), `dev-kafka.yml` (single-node Kafka broker
  up/status/down only — does not enable the outbox relay).
- **Load test**: `loadtest.yml` — manual dispatch with profile/scenario inputs.
- `claude-review.yml` — Claude PR review, triggered by an `@claude` comment.

iOS builds/deploys are **not in CI** — they run manually via fastlane
(`app/legacy/app-dev/ios/fastlane/`, lane `beta`: archive → TestFlight upload).

## Key docs

- `docs/prd/<product>/<feature>/` — team-shared per-feature docs (PRD / policy / IA / high-level / low-level design / diagrams); `product` is `gromo` or `fishcat`. Structure in `docs/README.md`.
- `docs/conventions/` — team-wide rules: `git-pr-conventions.md` (branch · title · body · assignee/label · review · merge), `jira-conventions.md` (4-axis classification + field ids), `jira-ticket-template.md` (ticket body + creation gate), `date-axis.md`, `error-contract.md`, `backend-layering.md`.
- `server/data-api/docs/db/schema.dbml` — canonical DB schema (DBML, **tracked** — the `docs/db/` whitelist in `server/data-api/.gitignore`, GROMO-735; keep it in sync and commit it with its migration). Schema deltas are applied by **Flyway** migrations in `server/data-api/src/main/resources/db/migration/` (`V1__baseline.sql` onward); the `run-migration-v*.sh` scripts next to it are a legacy archive.
- `loadtest/README.md` — load-testing harness guide. `server/observability/README.md` — dev observability stack guide.
- `server/data-api/HELP.md` — Spring Boot reference notes.
