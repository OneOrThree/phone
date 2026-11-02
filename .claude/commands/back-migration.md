---
description: Create the next Flyway migration (V<N+1>__<desc>.sql) for a schema change
argument-hint: "<the schema change, e.g. friendships 테이블에 status 컬럼 추가>"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Author a database schema change: **$ARGUMENTS**

Steps:
1. Discover the current migration version: glob
   `server/data-api/src/main/resources/db/v0/V*__*.sql` and take the **numeric** max of
   the `V(\d+)__` prefix — never sort lexicographically (`V9` sorts after `V10`).
   The new file is `V<N+1>__<short_snake_case_desc>.sql` in the same directory.
   `db/migration` 은 동결된 과거 이행 자료이므로 버전 계산이나 새 파일 생성 대상으로 사용하지 않는다.
   기존 DB를 V0로 전환·복구하는 요청이면 이 스캐폴드 대신
   `server/data-api/docs/db/README.md`의 검증·백업·명시적 전환 절차를 따른다.
2. Read the 1–2 most recent migrations and match their exact style: a Korean header
   comment (`-- GROMO-####: 무엇을 왜 바꾸는지`) followed by plain forward DDL.
3. Guardrails (all required):
   - **Never edit an already-applied/pushed migration** — Flyway checksums every
     file; fix mistakes with a new `V<N+2>` migration instead.
   - Forward-only DDL. No destructive statements (`DROP TABLE` / `DROP COLUMN` /
     data-loss rewrites) unless the request explicitly asks for them.
   - Never touch `flyway_schema_history`.
   - **버전 충돌 가드**: 다른 브랜치가 스캐폴드와 머지 사이에 같은 `V<N+1>` 을 먼저 차지할 수 있다.
     파일 이름이 달라 git 은 충돌 없이 합치지만 Flyway 는 중복 번호를 거부한다.
     data-api 테스트가 `db/v0` 를 Flyway 로 실제 적용하므로(`OutboxTestPostgres`) 중복 번호는 테스트에서 실패한다.
     다만 다른 브랜치가 머지된 뒤에 CI 를 다시 돌려야 드러난다. 그래서 머지 직전에
     `git fetch origin main` 을 먼저 하고(낡은 로컬 ref 는 가드를 무력화한다),
     `origin/main` 의 마이그레이션 폴더를 다시 훑어 번호가 찼으면 다음 빈 번호로 바꾼다.
4. Update `server/data-api/docs/db/schema.dbml` (DBML — the canonical schema doc,
   **tracked** via the `docs/db/` whitelist, GROMO-735; commit it with the migration)
   to reflect the new columns/tables so it stays in sync with the current DB state.
5. If the change affects JPA entities, point out which `<domain>/repository/domain/` entities
   and repositories need updating (or update them if I asked for the full change),
   keeping them aligned with the new columns/tables.
6. Remind me that:
   - nothing runs locally — the `local` profile has Flyway disabled
     (`ddl-auto: update`); dev/prod/loadtest apply migrations automatically on boot
     with `ddl-auto: validate`;
   - `server/data-api/docs/db/test-{rebase-v0,deploy-v0,backoffice-bridge-integration,compare-schema-dbml}.py`
     4종은 지금 PR CI 에서 돌지 않는다(꺼진 `data-api-ci.dev.yml` 의 `db-tools` 잡에만 있다. CI 복구는 별도 작업).
     그래서 마이그레이션 PR 은 머지 전에 저장소 루트에서 로컬로 돌린다
     (`backoffice-bridge-integration` 은 Docker 가 필요하다):
     `for t in rebase-v0 deploy-v0 backoffice-bridge-integration compare-schema-dbml; do python3 server/data-api/docs/db/test-$t.py || break; done`;
   - the PR must flag this DB-schema change in the "DB 변경 (백엔드)" section of
     `.github/pull_request_template.md`.

Create/modify files only — **do not commit, push, or run the migration against any
database**.
