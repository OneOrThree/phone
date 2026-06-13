# back/ — Spring Boot backend

REST API for **gromo**. Loads in addition to the root `CLAUDE.md`.
Run all commands below from inside `back/`.

## Stack

- Spring Boot 4.0.6 / Java 17 / Gradle.
- Spring Data JPA + Hibernate + PostgreSQL.
- JWT auth (JJWT) with a custom `JwtFilter`.
- WebSocket / STOMP for realtime.
- SpringDoc OpenAPI — Swagger UI at `/swagger-ui/index.html`, JSON at `/v0/api-docs`.
- P6Spy for SQL query logging.

## Layout & domains

- Entry point: `PhoneApplication.java`.
- Controllers: `AuthController`, `UserController`, `FocusController`,
  `EquipmentController`, `InventoryController`, `InGameCurrencyController`, `HealthController`.
- Domains: `User`/`UserStreak`, `Room`/`RoomMember`, `DailyFocusStat`/`FocusSession`,
  `CharacterEquipment`/`UserItem`, `LeagueGroup`/`LeagueTierConfig`, `SocialAccount`.

## Conventions

Enforced by `config/checkstyle/checkstyle.xml` (Google Java Style, modified):

- 4-space indent, 120-column lines.
- UpperCamelCase classes, lowerCamelCase members, UPPER_SNAKE_CASE constants.
- No unused imports.
- Lombok is in use.

## Profiles

`local`, `dev`, `staging`, `prod`, `ci` via `application-*.yml`. Tests run under the
`ci` profile (`SPRING_PROFILES_ACTIVE=ci`).

## Commands

- `./gradlew build` — full build.
- `./gradlew test` — JUnit 5 + Testcontainers (PostgreSQL).
- `./gradlew checkstyleMain checkstyleTest` — style checks.
- `./gradlew spotbugsMain` — static analysis.
- `./gradlew jacocoTestReport` — coverage report.
- Local helpers: `./reset-db.sh`, `./test-local.sh`. Local DB via `docker-compose.local.yml`.

## Database changes

Schema lives in `docs/schema.dbml` and `docs/schema.sql`; migrations are
`docs/migration-v*.sql`. **Flag any DB schema change in the PR** (per the PR template).

## Deploy

`cd.yml` builds a Docker image and deploys to AWS (secrets from Secrets Manager
`oneorthree/phone`); health check at `/health`.

## Recommended skills & tools (backend workflow)

The fast path for working in `back/`:

- `superpowers:brainstorming` — before designing any new endpoint/feature.
- `superpowers:test-driven-development` — default for new logic (JUnit 5 + Testcontainers).
- `superpowers:systematic-debugging` — for test failures / unexpected behavior.
- `/back-check` — local CI gate (Checkstyle + SpotBugs + tests) before pushing.
- `/back-endpoint <설명>` — scaffold a Controller→Service→Repository→DTO + test slice.
- `/back-migration <설명>` — create the next migration SQL and sync `schema.dbml`/`schema.sql`.
- `spring-reviewer` (subagent) — focused Java/JPA/security/convention review of the diff.
- `/code-review` — repo-wide correctness + cleanup pass on the diff before a PR.
- `/security-review` — run when touching auth / `JwtFilter` / endpoints / secrets.
- `/verify` — confirm a change actually runs before claiming it's done.
- **Serena symbol tools** (Java LSP is enabled): `get_symbols_overview`, `find_symbol`,
  `find_referencing_symbols` — navigate/refactor Java by symbol instead of reading whole
  files (token-cheap; ideal for tracing service→repository call paths).
- `update-config` — when changing harness settings, hooks, or permissions.
