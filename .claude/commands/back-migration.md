---
description: Create the next DB migration SQL and keep schema.dbml / schema.sql in sync for a schema change
argument-hint: "<the schema change, e.g. friendships 테이블에 status 컬럼 추가>"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Author a database schema change: **$ARGUMENTS**

Steps:
1. Discover the current migration version: list `docs/migration-v*.sql` (e.g.
   `ls docs/migration-v*.sql`) and find the highest `v<N>`. The new file is
   `docs/migration-v<N+1>.sql`. If none exist, start at `docs/migration-v1.sql`.
2. Read the latest existing migration to match its exact style (header comments,
   statement formatting, idempotency conventions). Write the new migration with forward
   DDL for the requested change.
3. Update the canonical schema docs so they stay consistent with the migration:
   - `docs/schema.dbml` (DBML source of truth)
   - `docs/schema.sql` (SQL schema)
   Keep table/column naming and types identical to the migration.
4. If the change affects JPA entities, point out which `domain/<feature>/` entities and
   repositories need updating (or update them if I asked for the full change), keeping
   them aligned with the new schema.
5. Remind me that the PR must flag this DB-schema change in the "DB 스키마 변경" section of
   `.github/pull_request_template.md`.

Create/modify files only — **do not commit, push, or run the migration against any
database**. If I want to verify locally, I can reset with `back/reset-db.sh`.
