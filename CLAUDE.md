# CLAUDE.md

Guidance for Claude Code when working in this repository. This root file applies
everywhere. **Nested `CLAUDE.md` files load automatically** when you work inside a
subtree — see `app/.claude/CLAUDE.md` (frontend) and `back/CLAUDE.md` (backend) for the
details of each half. Keep this root file limited to shared, repo-wide concerns.

## Project overview

**gromo** — a focus-time management + character-customization mobile app.
Users run focus sessions, track screen time, and customize a 2D character with
shop items. Company `oneorthree`; iOS bundle id `com.oneorthree.gromo`.

## Monorepo layout

| Path                 | What it is |
| -------------------- | ---------- |
| `app/`               | React Native + Expo frontend (TypeScript). Includes `app/ios/` native project and the `screentimereport` Screen Time extension. See `app/.claude/CLAUDE.md`. |
| `back/`              | Spring Boot 4 + Java 17 + PostgreSQL REST API. See `back/CLAUDE.md`. |
| `loadtest/`          | k6 load-testing harness (scenarios, GCP runner terraform, trigger dashboard). See `loadtest/README.md`. |
| `observability/`     | Prometheus / Grafana / Loki / Datadog configs for the dev observability overlay. See `observability/README.md`. |
| `.github/workflows/` | CI/CD pipelines (see below). |

Gitignored local-only dirs (machine-specific, not in git): `docs/` (planning
scratch — tickets, reports, specs), `logs/` (work journals), `back/docs/`
(schema.dbml + legacy migration scripts), `app/.docs/` (planning/design docs).

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
- **Commit / PR title**: `[TYPE] GROMO-#### 한 줄 요약` — TYPE ∈ `FEAT` / `FIX` / `CHORE` / `REFACTOR`, `GROMO-####` is the Jira ticket.
- **PR body** follows `.github/pull_request_template.md`: Jira link, change type,
  summary, change details, and **DB schema changes** if any.
- **Referencing tickets**: only the ticket the PR **directly implements** gets the full
  key (`GROMO-####`) — the full key makes the Jira integration attach this PR's history to
  that ticket. For **related/reference tickets** the PR does not implement, write the
  **number only** so no PR history is attached (e.g. `GROMO-455` → "ticket 455").
- `main` is the integration branch. **`git add`, `git commit`, and `git push` are the
  user's to run** — never stage, commit, or push without an explicit, per-action request,
  and ask right before each one. One approval does not carry to the next action. (Creating
  branches, checking out, and local builds are fine without asking.)

## CI/CD (`.github/workflows/`)

Pipelines are path-filtered — `app/**` changes and `back/**` changes trigger
different jobs. This list rots; the authoritative source is `ls .github/workflows/`
plus each file's `name:`.

- **App**: `lint.yml` — ESLint + Prettier + tsc on `app/**`.
- **Backend PR gate**: `ci.yml` orchestrates the reusable (`workflow_call`)
  `check-style-backend.yml` / `test-backend.yml` / `spot-bugs.yml` — Checkstyle,
  tests (JUnit + Testcontainers), and SpotBugs on `back/**`.
- **Dev deploy**: `cd.yml` — `main` push → backend Docker image → AWS dev.
- **Prod**: `prod-ci.yml` (verifies PRs to `release`; builds + pushes the image on
  `release` push) → `prod-cd.yml` (auto-deploys via `workflow_run`, or manual
  dispatch by SHA) → `prod-rollback.yml` (manual rollback).
- **API docs**: `api-dog-generate.yml` (OpenAPI generation on `main`/`release`/
  `bfeat|bfix|brefactor` pushes — `bchore` is excluded), `cleanup-api-docs.yml`
  (cleanup on branch delete — currently a **no-op**: its predicate checks a
  `refs/heads/` prefix that the `delete` event's `ref` never carries, so no
  branch deletion is cleaned and doc dirs accumulate on `gh-pages`; known gap).
- **Observability (manual dispatch)**: `dev-datadog.yml` (Datadog APM toggle),
  `dev-monitor.yml` (Prometheus/Grafana/Loki stack).
- **Load test**: `loadtest.yml` — manual dispatch with profile/scenario inputs.
- `claude-review.yml` — Claude PR review, triggered by an `@claude` comment.

iOS builds/deploys are **not in CI** — they run manually via fastlane
(`app/ios/fastlane/`, lane `beta`: archive → TestFlight upload).

## Key docs

- `back/docs/db/schema.dbml` — canonical DB schema (DBML, local-only/gitignored; keep it in sync). Schema deltas are applied by **Flyway** migrations in `back/src/main/resources/db/migration/` (`V1__baseline.sql` onward); the `run-migration-v*.sh` scripts next to it are a legacy archive.
- `loadtest/README.md` — load-testing harness guide. `observability/README.md` — dev observability stack guide.
- `back/HELP.md` — Spring Boot reference notes.
