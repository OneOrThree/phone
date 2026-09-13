# CLAUDE.md

Guidance for Claude Code when working in this repository. This root file applies
everywhere. **Nested `CLAUDE.md` files load automatically** when you work inside a
subtree — see `app/app-dev/.claude/CLAUDE.md` (frontend) and `server/data-api/CLAUDE.md`
(backend) for the details of each half. Keep this root file limited to shared,
repo-wide concerns.

## Project overview

**gromo** — a focus-time management + character-customization mobile app.
Users run focus sessions, track screen time, and customize a 2D character with
shop items. Company `oneorthree`; iOS bundle id `com.oneorthree.gromo`.

## Monorepo layout

| Path                    | What it is |
| ----------------------- | ---------- |
| `app/app-dev/`          | React Native + Expo frontend (TypeScript). Includes `app/app-dev/ios/` native project and the `screentimereport` Screen Time extension. See `app/app-dev/.claude/CLAUDE.md`. |
| `app/assets/`           | Source design assets (app icons, character art, videos) — tracked binaries, not bundled app resources (those live in `app/app-dev/src/assets/`). |
| `app/scripts/`          | Local web-run helpers (`local-web.sh`, `local-web.command`). |
| `server/data-api/`      | Spring Boot 4 + Java 17 + PostgreSQL REST API. See `server/data-api/CLAUDE.md`. |
| `server/realtime/`          | Spring Boot 4 realtime service — WebSocket/STOMP + Redis, its own `gromo_chat` DB. A **separate** Gradle project sharing no code with `data-api`. See `server/realtime/CLAUDE.md`. |
| `server/business-api/` | 공개 파일 링크 미리보기 Spring Boot 서비스. 독립 Gradle·전용 Redis. 실행·API 계약은 `server/business-api/README.md`. |
| `server/observability/` | Prometheus / Grafana / Loki / Datadog configs for the dev observability overlay. See `server/observability/README.md`. |
| `server/scripts/`       | The `docker-compose.*.yml` files (`dev` / `local` / `prod` / `datadog` / `observability` / `realtime`). |
| `loadtest/`             | k6 load-testing harness (scenarios, GCP runner terraform, trigger dashboard). See `loadtest/README.md`. |
| `docs/`                 | **Team-shared** docs, tracked in git: `docs/prd/<feature>/` with PRD, policy, IA, high-level/low-level design, diagrams; repo-wide conventions in `docs/conventions/`. See `docs/README.md`. |
| `.github/workflows/`    | CI/CD pipelines (see below). |

**`docs/` vs `doc/`**: `docs/` is the team-shared, committed documentation space
(`docs/prd/<feature>/` — PRD · policy · IA · high-level/low-level design · diagrams).
`doc/` is the owner's personal planning scratch (tickets, reports, specs, drafts) —
gitignored, never committed. Team-facing docs go in `docs/`; everything personal
stays in `doc/`.

Gitignored local-only dirs (machine-specific, not in git): `doc/` (personal
planning scratch — tickets, reports, specs), `logs/` (work journals),
`server/data-api/docs/` (local planning scratch, **except `server/data-api/docs/db/`
which is tracked** — schema.dbml), `app/app-dev/.docs/` (app-side personal
planning/design docs).

The frontend and backend share almost no tooling — work in the relevant subtree
and let its nested `CLAUDE.md` guide the specifics.

## Language convention

The whole project works in **Korean**: commit messages, PR text, code comments,
and docs are all Korean. Match this — write code comments and commit/PR text in
Korean. Keep code identifiers (types, functions, variables) in English.

## Git & PR conventions

- **Branch prefixes**: `<area><type>/` where type ∈ `feat`/`fix`/`refactor`/`chore`.
  **Backend work prepends `b`** (`bfeat/`, `bfix/`, `brefactor/`, `bchore/`); **app/frontend
  work prepends `a`** (`afeat/`, `afix/`, `arefactor/`, `achore/`). Bare `feat/`·`fix/`·
  `refactor/`·`chore/` are reserved for cross-cutting/tooling work that is neither backend-
  nor app-specific. e.g. a backend refactor is `brefactor/`, never bare `refactor/`.
  **Docs work** (`docs/`) uses the `doc/` prefix: new docs `doc/prd-<feature>`, edits
  `doc/fix-prd-<feature>`.
- **Commit / PR title**: `[TYPE] GROMO-#### 한 줄 요약` — TYPE ∈ `FEAT` / `FIX` / `CHORE` / `REFACTOR`, `GROMO-####` is the Jira ticket.
- **PR body** follows `.github/pull_request_template.md`: Jira link, change type,
  summary, change details, and **DB schema changes** if any.
- **Referencing tickets**: only the ticket the PR **directly implements** gets the full
  key (`GROMO-####`) — the full key makes the Jira integration attach this PR's history to
  that ticket. For **related/reference tickets** the PR does not implement, write the
  **number only** so no PR history is attached (e.g. `GROMO-455` → "ticket 455").
- **Creating Jira tickets**: follow `docs/conventions/jira-conventions.md` — every
  task/bug/subtask needs exactly one **`도메인`** value (the domain axis, a dropdown custom
  field); **epics do not get it** (their `[도메인]` name prefix plays that role). Epic is only
  for time-boxed initiatives and may be left empty; no `[Tag]` prefixes in task summaries
  (that info lives in `도메인`/Label).
- `main` is the integration branch. **`git add`, `git commit`, and `git push` are the
  user's to run** — never stage, commit, or push without an explicit, per-action request,
  and ask right before each one. One approval does not carry to the next action. (Creating
  branches, checking out, and local builds are fine without asking.)
  **Exception (team rule)**: the initial push of a just-created branch is automatic — the
  `.claude/settings.json` PostToolUse hook runs `git push -u origin <branch>` on
  `checkout -b`/`switch -c` so every branch exists on origin from the start. This is part
  of branch creation, not a content push (the new branch carries no unreviewed commits
  beyond its base).

## CI/CD (`.github/workflows/`)

Pipelines are path-filtered — `app/app-dev/**` changes and `server/data-api/**`
changes trigger different jobs. This list rots; the authoritative source is
`ls .github/workflows/` plus each file's `name:`.

- **App**: `app-lint.yml` — ESLint + Prettier + tsc + jest on `app/app-dev/**`;
  `app-android-build.yml` — Android build checks on native-affecting paths.
- **Business API · Notification**: `satellite-ci.yml` — `server/business-api/**` ·
  `server/notification/**` 매트릭스로 독립 Gradle build(Checkstyle·SpotBugs·Testcontainers 통합
  테스트)와 Docker 이미지 빌드. main push에서만 GAR, release push에서만 ECR 게시. 수동 dev overlay는
  `docker-compose.business.yml`.
- **Shared backend gate**: `be-gradle.yml` — the one reusable (`workflow_call`) workflow for JVM
  Gradle checks. Takes `service` / `runs-on` / `tasks` / `artifact-name` / `artifact-path` /
  `measure-jar`, and isolates `GRADLE_USER_HOME` per service. It starts **no database** — every
  service's tests bring their own via Testcontainers (GROMO-1793 verified data-api's 2,152 tests
  pass with the datasource pointed at a dead port). `runs-on` takes a **JSON array string**
  (`'["ubuntu-latest"]'`) unpacked with `fromJSON`; its default keeps the self-hosted labels, so a
  caller that omits it is unchanged.
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
  digest, which deploys to AWS dev (`dev-cd.yml` has no trigger of its own).
- **Prod**: `prod-ci.yml` (verifies PRs to `release`; builds + pushes the image on
  `release` push) → `prod-cd.yml` (auto-deploys via `workflow_run`, or manual
  dispatch by SHA) → `prod-rollback.yml` (manual rollback).
- **API docs**: `api-dog-generate.yml` (OpenAPI generation on `main`/`release`/
  `bfeat|bfix|brefactor` pushes — `bchore` is excluded), `api-docs-cleanup.yml`
  (cleanup on branch delete — currently a **no-op**: its predicate checks a
  `refs/heads/` prefix that the `delete` event's `ref` never carries, so no
  branch deletion is cleaned and doc dirs accumulate on `gh-pages`; known gap).
- **Observability (manual dispatch)**: `dev-datadog.yml` (Datadog APM toggle),
  `dev-monitor.yml` (Prometheus/Grafana/Loki stack).
- **Load test**: `loadtest.yml` — manual dispatch with profile/scenario inputs.
- `claude-review.yml` — Claude PR review, triggered by an `@claude` comment.

iOS builds/deploys are **not in CI** — they run manually via fastlane
(`app/app-dev/ios/fastlane/`, lane `beta`: archive → TestFlight upload).

## Key docs

- `docs/prd/<feature>/` — team-shared per-feature docs (PRD / policy / IA / high-level / low-level design / diagrams); structure in `docs/README.md`.
- `docs/conventions/jira-conventions.md` — Jira 4-axis convention (`도메인` dropdown = domain, Label = platform, Epic = time-boxed initiative, fixVersion = release). Read before creating or triaging tickets.
- `server/data-api/docs/db/schema.dbml` — canonical DB schema (DBML, **tracked** — the `docs/db/` whitelist in `server/data-api/.gitignore`, GROMO-735; keep it in sync and commit it with its migration). Schema deltas are applied by **Flyway** migrations in `server/data-api/src/main/resources/db/migration/` (`V1__baseline.sql` onward); the `run-migration-v*.sh` scripts next to it are a legacy archive.
- `loadtest/README.md` — load-testing harness guide. `server/observability/README.md` — dev observability stack guide.
- `server/data-api/HELP.md` — Spring Boot reference notes.
