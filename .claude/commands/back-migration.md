---
description: Create the next DB migration shell script (run-migration-v<N+1>.sh) for a schema change
argument-hint: "<the schema change, e.g. friendships 테이블에 status 컬럼 추가>"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Author a database schema change: **$ARGUMENTS**

Steps:
1. Discover the current migration version: list `back/docs/db/run-migration-v*.sh` and
   find the highest `v<N>`. The new file is `back/docs/db/run-migration-v<N+1>.sh`. If
   none exist, start at `run-migration-v1.sh`.
2. Read the latest existing script to match its exact style: the `#!/bin/bash` header,
   the usage comment, the `CONTAINER`/`DB`/`USER` defaults, and the
   `docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB" <<'EOF' … EOF` heredoc. Write the
   new script with the forward DDL for the requested change inside the heredoc, ending
   with `\echo '✅ migration-v<N+1> 완료'`.

   **Fail-loud guard (required).** A migration must NOT print "완료" when it actually
   failed. Include all of these so a wrong container name or a SQL error aborts the run:
   - `set -euo pipefail` right after the `USER=` defaults.
   - A container-existence check before any `docker exec` (catches the common mistake of
     passing the *image* name like `postgres:16-alpine` instead of the container NAME):
     ```bash
     if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
         echo "❌ '$CONTAINER' 컨테이너가 없습니다. docker ps 의 NAMES 값을 넘기세요 (이미지명 아님)." >&2
         exit 1
     fi
     ```
   - `-v ON_ERROR_STOP=1` on every `psql` invocation so a SQL error returns non-zero and
     (with `set -e`) aborts before the final 완료 line. The trailing "완료" echo then only
     runs on success.
3. Make the new script executable (`chmod +x`).
4. If the change affects JPA entities, point out which `domain/<feature>/` entities and
   repositories need updating (or update them if I asked for the full change), keeping
   them aligned with the new columns/tables.
5. Remind me that the PR must flag this DB-schema change in the "DB 스키마 변경" section of
   `.github/pull_request_template.md`.

After writing the script, update `back/docs/db/schema.dbml` (DBML — the canonical schema
doc) to reflect the new columns/tables so it stays in sync with the current DB state.

Note: these `run-migration-v*.sh` scripts are gitignored / local-only — they apply DDL
against my local Docker Postgres and are **not** committed.

Create/modify files only — **do not commit, push, or run the migration against any
database**.
