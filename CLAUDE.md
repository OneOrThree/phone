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
| `docs/`              | DB schema, design, and feature docs (see pointers below). |
| `.github/workflows/` | CI/CD pipelines (see below). |

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
different jobs.

- `lint.yml` — ESLint + Prettier on `app/**`.
- `ci.yml`, `check-style-backend.yml`, `test-backend.yml`, `spot-bugs.yml` — Checkstyle, tests (JUnit + Testcontainers), and SpotBugs on `back/**`.
- `testflight.yml` — iOS build & submit via EAS → TestFlight.
- `cd.yml` — backend Docker image → AWS deploy.
- `claude-review.yml` — Claude PR review, triggered by an `@claude` comment.

## Key docs

- `back/docs/db/schema.dbml` — canonical DB schema (DBML, reflects current state). Local-only migration scripts in `back/docs/db/` (`run-migration-v*.sh`, gitignored) apply each delta.
- `docs/design.md` — design spec. `docs/project-feature.md` — feature spec.
- `back/HELP.md` — Spring Boot reference notes.
