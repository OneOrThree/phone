---
description: Create the next Flyway migration (V<N+1>__<desc>.sql) for a schema change
argument-hint: "<the schema change, e.g. friendships 테이블에 status 컬럼 추가>"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Author a database schema change: **$ARGUMENTS**

Steps:
1. Discover the current migration version: glob
   `back/src/main/resources/db/migration/V*__*.sql` and take the **numeric** max of
   the `V(\d+)__` prefix — never sort lexicographically (`V9` sorts after `V15`).
   The new file is `V<N+1>__<short_snake_case_desc>.sql` in the same directory.
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
4. Update `back/docs/db/schema.dbml` (DBML — the canonical schema doc,
   gitignored/local-only) to reflect the new columns/tables so it stays in sync
   with the current DB state.
5. If the change affects JPA entities, point out which `<domain>/domain/` entities
   and repositories need updating (or update them if I asked for the full change),
   keeping them aligned with the new columns/tables.
6. Remind me that:
   - nothing runs locally — the `local` profile has Flyway disabled
     (`ddl-auto: update`); dev/staging/prod apply migrations automatically on boot
     with `ddl-auto: validate`;
   - the PR must flag this DB-schema change in the "DB 스키마 변경" section of
     `.github/pull_request_template.md`.

Create/modify files only — **do not commit, push, or run the migration against any
database**.
