# CLAUDE.md

Rules for Claude Code in this repository. They apply everywhere. A nested guide adds rules for its subtree and loads when you work there:

| Subtree | Nested guide |
| --- | --- |
| `app/app-dev/` | `app/app-dev/CLAUDE.md` (UI work: `app/app-dev/DESIGN.md`) |
| `app/legacy/app-dev/` | `app/legacy/app-dev/.claude/CLAUDE.md` |
| `server/data-api/` | `server/data-api/CLAUDE.md` |
| `server/realtime/` | `server/realtime/CLAUDE.md` |
| `backoffice/` | `backoffice/CLAUDE.md` → `backoffice/AGENTS.md` |

Before you change a server, read `server/<service>/README.md`: run commands, contracts and deploy notes live there.

## Product and words

Cattus is the app in which users, as cats, focus together on islands and grow their island with the fish they catch. This repository builds the mobile app, the four servers (Business API, Data API, Realtime, Notification) and the backoffice.

- Write with the terms in [CONTEXT.md](CONTEXT.md). Its `_Avoid_` lines list the old words.
- Keep identifiers that carry old names as they are (`GROMO-####`, `com.oneorthree.gromo`, `gromo_chat`, `catus-*`, code package `group`, …). CONTEXT.md lists them.
- 2.0 is the generation in development and production. Gromo 1.x (`app/legacy/`) is frozen at store version 1.1.0: it takes hotfixes only, never 2.0 features.

## Hard lines

Follow these in every task. An earlier approval, an open ticket or "keep going" does not lift them.

1. Start a production deploy only when the owner asks for that deploy. This covers running or rerunning a production CD (`prod-cd-V2`, `kafka-cd.prod-V2`, `redis-cd.prod-V2`, `backoffice-cd.prod-V2`, `app-android-cd`) and approving a production environment.
2. Keep load tests off AWS. Run no load, stress, limit or soak test against AWS or anything hosted there, from any machine, and create no test data for one (permanent since 2026-10-29). For performance work, use saved results, read-only logs and metrics, and isolated local runs.
3. Reach `main` and `release` only through PRs. Commit and push on your work branch only. Never force-push.
4. Use the V2 workflows. A workflow file whose first line is `# RETIRED:` is a V1 record: do not run it.
5. Treat the production fingerprint inputs as production. Changing one byte under `.github/scripts/catus-plan.py` `SHARED` (`.github/actions/ci-jar/`, `.github/scripts/ci-jar.py`, `.github/scripts/catus-*`, `.github/scripts/v2/prod/catus-runtime-V2.py`, `.github/workflows/prod-ci.yml`, `.github/workflows/be-gradle.yml`, `.dockerignore`, `server/gradle/`) rebuilds and redeploys all four servers at the next release. Change them only when the ticket is about them.
6. Treat a backoffice code merge as a production deploy. A merge to `main` that touches `backoffice/**` (except `.md`) starts `backoffice-cd.prod-V2`, which deploys to production after one approval. There is no dev backoffice.

## Repository map

| Path | What it is |
| --- | --- |
| `app/app-dev/` | The 2.0 mobile app: React Native + Expo (TypeScript) with native iOS and Android projects. It calls Business API over HTTP and Realtime over `/ws/realtime`, and keeps local state on the device. Mock data runs only in demo and review modes. |
| `app/legacy/` | The frozen Gromo 1.x app (`app-dev/`), its source art (`assets/`) and local web helpers (`scripts/`). No CI covers it. |
| `server/business-api/` | Public HTTP API of the app, including the screen bundles `/screens/*`. |
| `server/data-api/` | Product data and its rules. Business API calls it over `/internal/*`. |
| `server/realtime/` | STOMP chat and presence over WebSocket, with its own database `gromo_chat`. |
| `server/notification/` | Push notifications: takes notification events from Kafka and sends them through FCM. |
| `server/scripts/` | Compose files for local runs, the old dev VM and the Gromo 1.x production host (`server/scripts/README.md`). The V2 runtime files are in `server/scripts/v2/` (`dev/`, `prod/`); the rest of the V2 runtime lives in the Infra repository. |
| `server/observability/` | Monitoring settings: Prometheus, Grafana and Loki for the old dev VM, and Datadog. |
| `backoffice/` | Operators' web: notices, operators' letters, minimum app versions, the cat magazine, policies, release status. |
| `smoke/` | Server smoke cases. `ops-smoke.dev-v2` runs them after a dev V2 deploy. |
| `assets-cdn/`, `scripts/assets-cdn/` | Image CDN packs and their publisher (dev CDN only). |
| `loadtest/` | k6 harness for GCP runners. See `loadtest/README.md`. |
| `docs/` | Team docs. Index: [docs/README.md](docs/README.md). |
| `.github/` | Workflows and CI scripts. |
| `.claude/` | Hooks, commands and agents for Claude Code. |

Local-only, gitignored folders: `doc/` (owner's planning scratch), `logs/`, `server/data-api/docs/` except `docs/db/`, `app/app-dev/.docs/`, `app/legacy/app-dev/.docs/`. Put anything for teammates in `docs/`.

## Language

Write commit messages, PR text, code comments and docs in Korean. Keep code identifiers in English. `CLAUDE.md` files are in English.

## Git and PRs

The canon is [docs/conventions/git-pr-conventions.md](docs/conventions/git-pr-conventions.md). When this summary and the canon disagree, the canon wins.

- Create the branch before the first edit: `<area><type>/GROMO-####-<slug>`. `b` = `server/**`, `a` = `app/**`, `doc/` = `docs/**` only, no prefix for cross-cutting work (`.github/`, `.claude/`, `backoffice/`, `smoke/`, `assets-cdn/`). The settings hook pushes a new branch when you create it.
- Title commits and PRs `[TYPE] GROMO-#### 한 줄 요약`, with TYPE one of `FEAT`, `FIX`, `CHORE`, `REFACTOR`. Write the body with the eight sections of `.github/pull_request_template.md`.
- Get approval for each `git add`, `git commit` and `git push` through the permission prompt.
- After you open a PR, post one `@claude` review request with 3–5 points for this PR. Never write `@claude` in later replies.
- Merge only when the four merge conditions hold on the same commit. A person merges unless the owner delegated merging for the batch.
- A same-repository `main` → `release` promotion follows [AGENTS.md](AGENTS.md) 「main → release 운영 승격」.

Hooks in `.claude/settings.json` enforce part of this:

- `.claude/pr-gate.py` rejects a `gh pr create` that breaks the canon.
- `.claude/jira_gate.py` rejects a Jira ticket with a missing or vague 완료 조건 or 산출물.
- `.claude/prod-impact.py` warns when an edit reaches production, and asks before you merge a PR that reaches production or rerun a production CD.
- `permissions.ask` asks before production workflow dispatches.

## Jira

The canon is [docs/conventions/jira-conventions.md](docs/conventions/jira-conventions.md) (classification, field ids) and [docs/conventions/jira-ticket-template.md](docs/conventions/jira-ticket-template.md) (body, creation gate).

- Give each task exactly one `도메인`. Epics take none.
- Create tickets with `/jira-assign` (one ticket) or `/jira-sync` (a whole PRD). Search for duplicates first.
- When the gate rejects a ticket, ask the user for the missing pieces in one AskUserQuestion. Do not invent them.
- To work on someone else's ticket, open a new ticket and link it in a comment.

## CI/CD

The map is [docs/engineering/pipeline-map.md](docs/engineering/pipeline-map.md): changed path → PR checks → after merge → production, plus workflows, environments and version axes. Read it before you change a workflow or plan a release. Facts to keep in mind:

- Pipeline V2 is live. dev V2 (GCP) follows `main` automatically. Production V2 (AWS) changes only when a person runs `prod-cd-V2` (and the Kafka and Redis CDs) from `release` and one approver of environment `catus-production-V2` approves the run (since 2026-11-02).
- `.github/scripts/app-server-gate.py` blocks app releases until the latest `prod-cd-V2` run on `release` has succeeded; a run that is waiting for approval, rejected, failed or cancelled keeps the block. When the owner has you start a production CD, ask for its approval at once.
- `release` is protected (since 2026-11-02): changes arrive only by PR, and every review conversation must be resolved before the merge.
- Android: since 2026-11-02 18:08 KST `app-android-cd` is enabled again. An app merge to `main` builds an AAB for production V2 and publishes it to the Play internal track.
- iOS: the dev TestFlight upload on `main` push is skipped because the repository variable `IOS_DEV_RUNNERS` is unset. `ios/testflight.sh --dev` builds still point at the old dev VM `oneorthree.dev.mooo.com` (ticket 2661).
- A new environment key goes into the per-service filter of `.github/scripts/write-compose-env.py` in the same PR; `.github/scripts/test_config_contract.py` fails otherwise (V2 renders through the same filter). dev V2 Realtime takes its keys from `rtkeys` in `.github/scripts/v2/dev/dev-env-V2.py`.

## Key docs

- [CONTEXT.md](CONTEXT.md): glossary.
- [docs/README.md](docs/README.md): index of PRDs (`docs/prd/fishcat/` = 2.0, `docs/prd/gromo/` = 1.x), architecture, engineering records.
- `docs/conventions/`: team rules. Git and PRs, Jira, API errors, backend layering, date axis, outbox events, server CI, Android CI/CD, iOS dev TestFlight runner, release protection.
- `server/data-api/docs/db/schema.dbml`: the tracked DB schema. Add a new Flyway file to `server/data-api/src/main/resources/db/v0/` as the highest number + 1; `db/migration` is frozen history. Details: `server/data-api/CLAUDE.md` 「Database changes」.
