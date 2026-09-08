# server/data-api/ — Spring Boot backend

REST API for **gromo**. Loads in addition to the root `CLAUDE.md`.
Run all commands below from inside `server/data-api/`.

## Stack

- Spring Boot 4.0.6 / Java 17 / Gradle.
- Spring Data JPA + Hibernate + PostgreSQL.
- JWT auth (JJWT) with a custom `JwtFilter`.
- WebSocket / STOMP for realtime.
- SpringDoc OpenAPI — Swagger UI at `/swagger-ui/index.html`, JSON at `/v0/api-docs`.
- P6Spy for SQL query logging.

## Layout & domains

**정본은 `docs/conventions/backend-layering.md`** (repo root). 아래는 요약이며,
둘이 어긋나면 그 문서가 맞다.

- Entry point: `PhoneApplication.java`.
- **Package layout is domain-based**: each domain owns its own
  `service/`·`repository/`(+`repository/domain/`)·`dto/`·`exception/` under
  `com.oneorthree.phone.<domain>`. Do **not** introduce a parallel layer-first
  layout (`phone/api/`, `phone/service/`, …) — keep new files inside their
  domain package.
- **Controllers sit at the domain root**, not in an `api/` sub-package —
  `user/UserController.java`, with Swagger annotations split into a sibling
  `user/UserControllerDocs.java` interface (GROMO-1621). Enumerate with a
  `**/*Controller.java` glob (30 as of 2026-09); don't trust any hardcoded list.
- **Id lookups go through `<domain>/repository/<Domain>QueryService`**, not the
  repository directly — it folds soft-delete filtering, lock choice and the
  not-found exception into one place (GROMO-1655; `user/repository/UserQueryService`
  is the reference). Method names keep the lock explicit (`…ForShare`/`…ForUpdate`)
  and separate "the target is missing" from "the caller is missing". Projections,
  range scans, search, and writes still call the repository directly. See
  `docs/conventions/backend-layering.md` §3.
- **Entities live in `<domain>/repository/domain/`** — persistence concerns stay
  under `repository/`. Exception: a domain that has entities but no repository keeps
  a plain `domain/` (only `analytics`). A composition domain has neither — `profile`
  owns no data at all, so it has no `domain/` folder to place.
- Cross-cutting code lives in `common/` (`common/port`, `common/id` for the UUID v7
  generator, `common/exception`, `common/logging`, `common/util`). Spring wiring and
  servlet filters live in the **top-level `config/`** package — not `common/config`,
  and never a per-domain `config/`.
- Domain packages (authoritative: `ls src/main/java/com/oneorthree/phone/`):
  `analytics`, `auth`, `bot`, `character`, `currency`, `focus`, `friend`, `group`,
  `invitelink`, `item`, `league`, `notification`, `profile`, `screentime`, `stats`,
  `user` — plus cross-cutting `common/` and `config/`.
- **Domains have a fixed height and references only go downward** (GROMO-1656) —
  `user` is the base and is referenced by everyone; `profile` sits on top and only
  composes. The table is in `docs/conventions/backend-layering.md` §4; consult it
  before adding a cross-domain injection, and invert with an event or a
  `common/port` interface when the need points upward.
- Optional per-domain sub-packages, used only when the domain has them:
  `support/` (pure helpers/policies — no injected repository or service),
  `event/` (events this domain publishes), `listener/` (handlers it subscribes),
  `client/` (outbound HTTP/FCM/OpenAI), `scheduler/` (`@Scheduled` entry points).
- **Entity PKs are UUID v7** — annotate the `@Id UUID id` field with `@GeneratedUuidV7`
  (`common/id`); repositories are `JpaRepository<Entity, UUID>`.
- Package names must match Checkstyle's `PackageName` rule
  (`^[a-z]+(\.[a-z][a-z0-9]*)*$`) — no underscores, no leading digits.

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
- Local helper: `./test-local.sh` spins up a throwaway `postgres:16-alpine` container, runs the tests, then tears it down.

## Docs

Team-shared feature docs (PRD · policy · IA · high-level/low-level design ·
diagrams per feature) live in the **repo-root `docs/prd/<feature>/`** (tracked;
see `docs/README.md`). `server/data-api/docs/` stays
local-only planning scratch — except the tracked `server/data-api/docs/db/` schema
whitelist (GROMO-735).

## Database changes

Schema is managed by **Flyway** (GROMO-670). The canonical DB schema is
`docs/db/schema.dbml` (DBML — keep it in sync with the current state), rendered at
<https://dbdiagram.io/d/GroMo-6a1e2ece2eeb2f46cd390435>.

- **New schema change**: add `src/main/resources/db/migration/V<N>__<desc>.sql` (Flyway
  runs migrations in version order) and update `schema.dbml` to match. Never edit an
  already-applied migration — fix mistakes with a new `V<N+1>` file (Flyway checksums them).
- **Baseline**: `V1__baseline.sql` is the current-state snapshot. Existing DBs are marked
  at V1 via `baseline-on-migrate` (V1 is not re-run); fresh/empty DBs run V1 onward.
- **Per profile**: dev/staging/prod apply migrations automatically on boot with
  `ddl-auto: validate`; `local` keeps `ddl-auto: update` with Flyway disabled; `ci` keeps
  `create-drop` with Flyway disabled. Flyway needs three deps (see `build.gradle`):
  `spring-boot-flyway` (Boot 4.0 splits autoconfig into per-tech modules), `flyway-core`,
  and `flyway-database-postgresql`.
- **Local setup (required since GROMO-670)**: your gitignored `application-local.yml`
  MUST set `spring.flyway.enabled: false`. Once `spring-boot-flyway` is on the classpath
  Flyway auto-activates by default, and against an existing `ddl-auto: update` local schema
  (no baseline marking) it fails on `bootRun`. Copy `application-local.yml.example` (which
  already includes this) to `application-local.yml` when setting up.
- The `docs/db/run-migration-v*.sh` scripts (up to v30, gitignored) are a **legacy
  archive** — do not add new ones. `/back-migration` scaffolds the next
  `V<N+1>__<desc>.sql` migration.
- **Flag any DB schema change in the PR** (per the PR template).

## Observability

- Spring Actuator + Micrometer expose health/metrics (`/actuator/prometheus`,
  GROMO-546) on the `dev`, `loadtest`, and `prod` profiles (GROMO-1489 added
  `prod` so custom metrics are not dev-only). Each of them puts the endpoint on
  **management port 9091**, which is never published to the host — only
  same-network collectors reach it. `/actuator/*` sits outside `JwtFilter`
  (`/api/*` only) and Boot runs the management port in a separate servlet
  context, so **port isolation is the only thing keeping it private**: never add
  `9091` to a compose `ports:` list.
- `server/scripts/docker-compose.observability.yml` overlays Prometheus + Grafana +
  Loki/Promtail on the dev stack; configs live in `server/observability/`
  (see its README).
- Datadog runs on both environments: `server/scripts/docker-compose.datadog.yml` +
  the manual `dev-datadog.yml` workflow toggle it on dev, and
  `server/scripts/docker-compose.prod.yml` carries the same wiring permanently. The
  OpenMetrics scrape config is baked into `server/data-api/Dockerfile` as a
  `com.datadoghq.ad.checks` label (prod hosts have no repo checkout to mount a
  config file from) — edit the metric list there.

## Deploy

- **Dev**: on `main` push, `dev-ci.yml` builds + pushes the image (`back:<sha>` to
  GAR) and calls the reusable `dev-cd.yml` with its digest, which deploys to AWS
  (OIDC role `gromo-dev-github-actions`, region `ap-northeast-2`, runtime secrets from
  Secrets Manager `gromo/dev/env`); health check at `/health`. Dev images use GAR, not
  ECR; host-bootstrap secrets (`gromo/dev/app-server`, `gromo/dev/ci-runner`) remain
  instance-role-only and are not loaded by the deployment workflow.
- **Prod**: `prod-ci.yml` (on `release`) builds + pushes the image →
  `prod-cd.yml` deploys it (auto via `workflow_run`, or manual dispatch by SHA);
  `prod-rollback.yml` rolls back manually.

## Recommended skills & tools (backend workflow)

The fast path for working in `server/data-api/`:

- `superpowers:brainstorming` — before designing any new endpoint/feature.
- `superpowers:test-driven-development` — default for new logic (JUnit 5 + Testcontainers).
- `superpowers:systematic-debugging` — for test failures / unexpected behavior.
- `/back-check` — local CI gate (Checkstyle + SpotBugs + tests) before pushing.
- `/back-endpoint <설명>` — scaffold a Controller→Service→Repository→DTO + test slice.
- `/back-migration <설명>` — scaffold the next Flyway `V<N+1>__<desc>.sql` in `src/main/resources/db/migration/`.
- `spring-reviewer` (subagent) — focused Java/JPA/security/convention review of the diff.
- `/code-review` — repo-wide correctness + cleanup pass on the diff before a PR.
- `/security-review` — run when touching auth / `JwtFilter` / endpoints / secrets.
- `/verify` — confirm a change actually runs before claiming it's done.
- **Serena symbol tools** (Java LSP is enabled): `get_symbols_overview`, `find_symbol`,
  `find_referencing_symbols` — navigate/refactor Java by symbol instead of reading whole
  files (token-cheap; ideal for tracing service→repository call paths).
- `update-config` — when changing harness settings, hooks, or permissions.
