---
description: Create the next Flyway migration (V<N+1>__<desc>.sql) for a schema change
argument-hint: "<the schema change, e.g. friendships 테이블에 status 컬럼 추가>"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Author a database schema change: **$ARGUMENTS**

Steps:
1. Discover the current migration version: glob
   `server/data-api/src/main/resources/db/v0/V*__*.sql` and take the **numeric** max of
   the `V(\d+)__` prefix — never sort lexicographically (`V9` sorts after `V15`).
   The new file is `V<N+1>__<short_snake_case_desc>.sql` in the same directory.
   `V0__baseline.sql` 이후 첫 후속 변경은 V1이다. 과거 `db/migration/V1`~`V117`은
   불변 검증 자료이므로 버전 계산이나 새 파일 생성 대상으로 사용하지 않는다.
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
   - **Version-collision guard**: another branch may claim the same `V<N+1>` between
     scaffold and merge — git merges duplicate versions without conflict (different
     filenames), but Flyway then fails on boot, and the `ci` profile has Flyway
     disabled so the PR gate won't catch it. Right before merging, run
     `git fetch origin main` first (a stale local ref defeats the guard), then
     re-scan `origin/main`'s migration dir and renumber to the next free version
     if taken.
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
   - the PR must flag this DB-schema change in the "DB 변경 (백엔드)" section of
     `.github/pull_request_template.md`.

Create/modify files only — **do not commit, push, or run the migration against any
database**.
