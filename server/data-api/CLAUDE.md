# server/data-api/ — Spring Boot backend

**Catus 2.0의 내부 API와 데이터 정본**을 담당한다. 루트 `CLAUDE.md` 규칙을 함께 따른다.
아래 명령은 `server/data-api/`에서 실행한다.

## Stack

- Spring Boot 4.0.6 / Java 17 / Gradle.
- Spring Data JPA + Hibernate + PostgreSQL.
- 내부 HTTP 인증은 `InternalAuthFilter`의 서비스 토큰·경로 허용목록으로 처리한다.
  `auth` 도메인은 JJWT 기반 사용자 토큰과 로그인 세션을 발급·검증한다.
- WebSocket / STOMP 런타임은 별도 `server/realtime/`이 담당한다.
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
- **현행 HTTP 진입점은 `internal/`과 공통 health 경로**다.
  `internal/InternalFocusSessionController.java`처럼 내부 계약에 맞는 위치에 두고,
  실제 표면은 `**/*Controller.java`로 확인한다. 폐기한 Gromo 1.x 공개 컨트롤러를
  신규 기능의 기준으로 사용하지 않는다. 도메인 컨트롤러를 둘 때는 도메인 루트에
  배치하고 Swagger 계약은 형제 `*ControllerDocs` 인터페이스로 분리한다(GROMO-1621).
- **Id lookups go through `<domain>/repository/<Domain>QueryService`**, not the
  repository directly — it folds soft-delete filtering, lock choice and the
  not-found exception into one place (GROMO-1655; `user/repository/UserQueryService`
  is the reference). Method names keep the lock explicit (`…ForShare`/`…ForUpdate`)
  and separate "the target is missing" from "the caller is missing". Projections,
  range scans, search, and writes still call the repository directly. See
  `docs/conventions/backend-layering.md` §3.
- **Entities live in `<domain>/repository/domain/`** — persistence concerns stay
  under `repository/`. 자기 데이터가 없는 조합 도메인은 엔티티 패키지를 만들지 않는다.
- Cross-cutting code lives in `common/` (`common/port`, `common/id` for the UUID v7
  generator, `common/exception`, `common/logging`, `common/util`). Spring wiring and
  servlet filters live in the **top-level `config/`** package — not `common/config`,
  and never a per-domain `config/`.
- 현행 도메인은 사용자·인증·탈퇴, 집중·스크린타임, 친구·편지, 섬·멤버십·건설·퀘스트,
  외양·상점·물고기 경제, 순위·통계, 알림·outbox를 담당한다.
  실제 패키지는 `src/main/java/com/oneorthree/phone/`에서 확인한다.
- **Domains have a fixed height and references only go downward** (GROMO-1656).
  `outbox`는 내구 명령 기반, `user`는 계정 기반이며 `internal`은 도메인을 조합한다.
  Cross-domain injection을 추가할 때 `docs/conventions/backend-layering.md` §4의
  의존 방향을 확인하고, 상향 참조는 이벤트나 `common/port` 인터페이스로 역전한다.
- Optional per-domain sub-packages, used only when the domain has them:
  `support/` (pure helpers/policies — no injected repository or service),
  `event/` (events this domain publishes), `listener/` (handlers it subscribes),
  `client/` (outbound HTTP/FCM), `scheduler/` (`@Scheduled` entry points).
- **Entity PKs are UUID v7** — annotate the `@Id UUID id` field with `@GeneratedUuidV7`
  (`common/id`); repositories are `JpaRepository<Entity, UUID>`.
- **Error responses**: one envelope `{code, message}`; `code` is the `ErrorCode` enum
  constant name and the app branches on it, so constant names are a contract. A domain's
  `XxxErrorCode implements ErrorCode` + `XxxException extends DomainException` are caught by
  the single `GlobalExceptionHandler.handleDomain` — never add a per-domain handler.
  Rules and the pinned contract test: `docs/conventions/error-contract.md` (GROMO-1657).
- **Satellite events/commands go through `OutboxCommandPort.append` in the domain's own
  transaction**, from one `<Axis>Events` adapter per ordering axis. Event id, targets
  (REALTIME has no transport yet), receipts vs events, PII and producer flags:
  `docs/conventions/outbox-events.md` (GROMO-1798).
- Package names must match Checkstyle's `PackageName` rule
  (`^[a-z]+(\.[a-z][a-z0-9]*)*$`) — no underscores, no leading digits.

## Conventions

Enforced by `config/checkstyle/checkstyle.xml` (Google Java Style, modified):

- 4-space indent, 120-column lines.
- UpperCamelCase classes, lowerCamelCase members, UPPER_SNAKE_CASE constants.
- No unused imports.
- Lombok is in use.

## Profiles

추적된 `application-*.yml`에서 `dev`, `loadtest`, `prod`, `ci`와 기능별 프로파일을
확인한다. 로컬 설정은 `application-local.yml.example`을 복사한다. 테스트 기본은
`ci`(`SPRING_PROFILES_ACTIVE=ci`)이며 운영 스키마 통합 테스트는 Flyway 배선을 별도로 켠다.

## Commands

- `./gradlew build` — full build.
- `./gradlew test` — JUnit 5 + Testcontainers (PostgreSQL).
- `./gradlew checkstyleMain checkstyleTest` — style checks.
- `./gradlew spotbugsMain` — static analysis.
- `./gradlew jacocoTestReport` — coverage report.
- Local helper: `./test-local.sh` spins up a throwaway `postgres:16-alpine` container, runs the tests, then tears it down.

## Docs

Team-shared feature docs (PRD · policy · IA · high-level/low-level design ·
diagrams per feature) live in the **repo-root `docs/prd/<product>/<feature>/`** (tracked;
see `docs/README.md`). `server/data-api/docs/` stays
local-only planning scratch — except the tracked `server/data-api/docs/db/` schema
whitelist (GROMO-735).

## Database changes

스키마 실행 정본은 **Flyway `src/main/resources/db/v0/`**이며,
`docs/db/schema.dbml`은 그 구조를 문서화한다.

- **새 스키마 변경**: `db/v0/`의 가장 큰 숫자 버전 다음에
  `V<N+1>__<desc>.sql`을 추가하고 `schema.dbml`을 함께 갱신한다. 첫 후속 변경은
  `V1__*.sql`이다. 적용한 마이그레이션은 수정하지 않고 새 버전으로 보정한다.
- **V0와 과거 체인**: `db/v0/V0__baseline.sql`은 빈 DB의 시작점이다.
  `db/migration/V1`~`V138`은 과거 이행 테스트·전환 검증용 불변 자료이며,
  새 마이그레이션을 추가하거나 애플리케이션 실행 경로로 선택하지 않는다.
- **기존 dev/prod DB 전환 또는 복구 작업**: 먼저 [DB 전환 절차](docs/db/README.md)를
  읽는다. `rebase-v0.py`의 대상·이력·스키마 검증, 읽기 전용 계획, 전체 백업,
  writer 중지와 명시적 전환 절차를 따른다. `baseline-on-migrate`는 꺼져 있으며
  새 이미지를 먼저 기동하는 것으로 기존 DB가 V0로 전환되지 않는다.
- **프로파일**: dev/prod/loadtest는 `db/v0`와 `ddl-auto: validate`를 사용한다.
  local은 Flyway를 끈 `ddl-auto: update`, ci 기본은 Flyway를 끈 `create-drop`이다.
  운영 스키마를 확인하는 테스트는 `OutboxTestPostgres`의 V0·`validate` 배선을 사용한다.
  로컬 설정의 `spring.flyway.enabled: false`를 유지한다.
- **검증**: 스키마 변경 후 `docs/db/verify-schema-dbml.sh`로 실제 V0 체인과 DBML을
  대조하고, 변경한 제약·데이터 이행을 해당 통합 테스트로 확인한다.
  폐기된 `reset-db.sh`/`setup-dev-db.sh`와 `run-migration-v*.sh`는 새 작업에 사용하지 않는다.
- **PR의 DB 변경 항목에 스키마 변경을 명시한다**. 기존 loadtest seed의 V0 비호환과
  전환 도구의 적용 범위도 [DB 전환 절차](docs/db/README.md)에 정리되어 있다.
- **기본 데이터**: `db/seed/insert.sql`을 빌드 시 `db/v0/afterMigrate__defaults.sql`로 복사한다.
  신규 DB와 재배포의 Flyway migrate 완료 후 누락된 기본 행을 보완하며 Flyway 이력(V0 체인 — V0·V1 …)에 행을 더하지 않는다.
- **Read models**: `island_weekly_focus` (V130) is the weekly island-ranking numerator. Session completion
  (`FocusSessionLifecycleService.settle`) adds to it in the same transaction and the Sunday freeze cron recomputes
  the finished week (`IslandWeeklyFocusService.recompute`). A fixture that inserts COMPLETED sessions directly must
  call `recompute` before reading rankings.
  `island_id` deliberately has no FK to `islands`: the FK check in `recompute`'s INSERT would take a `islands` row
  KEY SHARE while holding the table lock, inverting `finish`'s order (islands FOR UPDATE → table lock) and deadlocking.
  For the same reason the Sunday close is two transactions (recompute commits, then the denominator freeze opens),
  and `recompute` throws if called inside an active transaction.

## Observability

- Spring Actuator + Micrometer expose health/metrics (`/actuator/prometheus`,
  GROMO-546) on the `dev`, `loadtest`, and `prod` profiles (GROMO-1489 added
  `prod` so custom metrics are not dev-only). Each of them puts the endpoint on
  **management port 9091**, which is never published to the host — only
  same-network collectors reach it. 내부 인증 필터는 `/internal/*`에만 적용되고
  Boot의 management 포트는 별도 servlet context이므로 **포트 격리를 유지한다**: never add
  `9091` to a compose `ports:` list.
- `server/scripts/docker-compose.observability.yml` overlays Prometheus + Grafana +
  Loki/Promtail on the dev stack; configs live in `server/observability/`
  (see its README).
- Dev Datadog은 `server/scripts/docker-compose.datadog.yml`과 수동
  `ops-datadog.dev.yml`로 관리한다. Catus prod 실행 구성은 아래 Deploy 안내의
  Infra 경로에서 확인한다. OpenMetrics 수집 목록은 `server/data-api/Dockerfile`의
  `com.datadoghq.ad.checks` 라벨에 있으므로 수집 메트릭 변경은 그 목록에 반영한다.

## Deploy

- **Dev**: `main` push에서 `data-api-ci.dev.yml`이 GAR 이미지를 발행하고
  `data-api-cd.dev.yml`이 digest를 받아 배포한다. 실행 대상·서비스별 환경변수·health
  판정은 루트 `CLAUDE.md`의 CI/CD 안내와 해당 워크플로를 기준으로 확인한다.
- **Prod**: Catus 2.0은 루트의 `prod-ci.yml`로 변경 서비스 이미지를 발행하고,
  `prod-cd.yml`로 수동 SSM 배포·버전 지정 롤백을 수행한다. 실행 구성은 Infra의
  `prod/catus/runtime` 소유이며 기존 Gromo 1.x 운영과 분리한다. 선행 조건과 실행 절차는
  `docs/prd/fishcat/server-separation/deployment.md`의 「Catus 2.0 운영 발행·배포」를 따른다.

## Recommended skills & tools (backend workflow)

The fast path for working in `server/data-api/`:

- `superpowers:brainstorming` — before designing any new endpoint/feature.
- `superpowers:test-driven-development` — default for new logic (JUnit 5 + Testcontainers).
- `superpowers:systematic-debugging` — for test failures / unexpected behavior.
- `/back-check` — local CI gate (Checkstyle + SpotBugs + tests) before pushing.
- `/back-endpoint <설명>` — scaffold a Controller→Service→Repository→DTO + test slice.
- `/back-migration <설명>` — scaffold the next Flyway `V<N+1>__<desc>.sql` in `src/main/resources/db/v0/`.
- `spring-reviewer` (subagent) — focused Java/JPA/security/convention review of the diff.
- `/code-review` — repo-wide correctness + cleanup pass on the diff before a PR.
- `/security-review` — run when touching auth / `InternalAuthFilter` / endpoints / secrets.
- `/verify` — confirm a change actually runs before claiming it's done.
- **Serena symbol tools** (Java LSP is enabled): `get_symbols_overview`, `find_symbol`,
  `find_referencing_symbols` — navigate/refactor Java by symbol instead of reading whole
  files (token-cheap; ideal for tracing service→repository call paths).
- `update-config` — when changing harness settings, hooks, or permissions.
