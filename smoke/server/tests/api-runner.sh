#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
PID=''
mkdir "$TMP/runner"
cp "$HERE/run.sh" "$HERE/core-flow.sh" "$HERE/prepare-statistics.sh" "$HERE/lib.sh" "$HERE/stomp-connect.mjs" "$HERE/guest_login.py" "$HERE/guest-budget.py" "$TMP/runner/"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/runner/prepare-friendship.sh"
printf '#!/usr/bin/env bash\n[[ "${MOCK_SEED_SUCCESS:-0}" == 1 ]]\n' > "$TMP/runner/seed-core-flow.sh"
chmod +x "$TMP/runner/prepare-friendship.sh" "$TMP/runner/seed-core-flow.sh"
mkdir "$TMP/bin"
REAL_JQ=$(command -v jq)
export REAL_JQ SMOKE_TEST_ARGV_LOG="$TMP/argv.log"
cat > "$TMP/bin/jq" <<'WRAPPER'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$SMOKE_TEST_ARGV_LOG"
exec "$REAL_JQ" "$@"
WRAPPER
chmod +x "$TMP/bin/jq"
export PATH="$TMP/bin:$PATH"

trap '[[ -z "$PID" ]] || kill "$PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
run_case() {
  local name=$1 health=$2 no_event=$3 bad_screen=$4 expected=$5 basic=${6:-0} ownership=${7-66666666-6666-4666-8666-666666666666} core_enabled=${8:-0}
  if [[ "$name" == main-cleanup-append ]]; then
    printf 'id\tstatus\thttp_code\tms\treason\nSMOKE-SERVER-004\tPASS\t200\t1\t이전 실행\n' > "$TMP/$name.tsv"
  fi
  MOCK_REQUEST_LOG="$TMP/$name.requests" MOCK_GUEST_FAILURES="${MOCK_GUEST_FAILURES:-0}" MOCK_OWNERSHIP_TOKEN="$ownership" MOCK_HEALTH_FAIL="$health" MOCK_NO_EVENT="$no_event" MOCK_BAD_SCREEN="$bad_screen" node "$HERE/tests/mock-api.mjs" "$TMP/port" & PID=$!
  for ((i=0;i<100;i++));do [[ -s "$TMP/port" ]] && break; sleep .02;done
  local port;port=$(cat "$TMP/port")
  node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({accessToken:"header."+Buffer.from(JSON.stringify({sid:"55555555-5555-4555-8555-555555555555"})).toString("base64url")+".signature",islandId:"33333333-3333-4333-8333-333333333333"}))' "$TMP/context.json"
  set +e
  local context_file="$TMP/context.json"
  [[ "${MOCK_NO_CONTEXT:-0}" != 1 ]] || context_file=''
  SMOKE_BASIC_ONLY="$basic" SMOKE_CORE_ENABLED="$core_enabled" BASE_URL="http://127.0.0.1:$port" SMOKE_CORE_CONTEXT_FILE="$context_file" SMOKE_EVENT_TIMEOUT_MS=300 SMOKE_SUBSCRIBE_SETTLE_MS=50 RESULTS_FILE="$TMP/$name.tsv" "$TMP/runner/run.sh" > "$TMP/$name.log" 2>&1
  local actual=$?
  set -e
  [[ "$actual" == "$expected" ]] || { cat "$TMP/$name.log"; return 1; }
  if [[ "$name" == basic || "$name" == guest-retry ]];then
    [[ $(awk -F '\t' '$2=="PASS"{n++}END{print n}' "$TMP/$name.tsv") == 9 ]] || { cat "$TMP/$name.tsv"; return 1; }
    if [[ "$name" == basic ]]; then
      [[ $(awk '$1=="POST" && $2=="/islands"{n++}END{print n+0}' "$TMP/$name.requests") == 0 ]] || { cat "$TMP/$name.requests"; return 1; }
      [[ $(awk '$1=="DELETE" && /\/memberships\/me$/{n++}END{print n+0}' "$TMP/$name.requests") == 0 ]] || { cat "$TMP/$name.requests"; return 1; }
    fi
    if [[ "$name" == guest-retry ]];then
      awk -F '\t' '$1=="SMOKE-SERVER-002" && $2=="PASS" && $5~/attempts=2/ && $5~/retries=1/{ok=1} END{exit !ok}' "$TMP/$name.tsv"
    fi
  elif [[ "$name" == success ]];then
    [[ $(awk -F '\t' '$2=="PASS"{n++}END{print n}' "$TMP/$name.tsv") == 11 ]] || { cat "$TMP/$name.tsv"; return 1; }
  elif [[ "$name" == statistics-created ]];then
    if ! awk -F '\t' '$1=="SMOKE-SERVER-014" && $2=="FAIL"{core=1} $1=="SMOKE-SERVER-015" && $2=="PASS"{statistics=1} END{exit !(core&&statistics)}' "$TMP/$name.tsv" ||
      [[ $(rg -c '^POST /islands$' "$TMP/$name.requests") != 3 ]] ||
      [[ $(rg -c '^DELETE /islands/33333333-3333-4333-8333-333333333333/memberships/me$' "$TMP/$name.requests") != 4 ]]; then
      cat "$TMP/$name.log" "$TMP/$name.tsv" "$TMP/$name.requests"
      return 1
    fi
  elif [[ "$name" == health ]];then
    awk -F '\t' '$1=="SMOKE-SERVER-001" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  elif [[ "$name" == event ]];then
    awk -F '\t' '$1=="SMOKE-SERVER-010" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
    awk -F '\t' '$1=="SMOKE-SERVER-006" && $2=="PASS"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  elif [[ "$name" == ownership* ]];then
    awk -F '\t' '$1=="SMOKE-SERVER-009" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  elif [[ "$name" == main-* ]];then
    [[ $(rg -c '^POST /islands$' "$TMP/$name.requests") == 1 ]] || { cat "$TMP/$name.log" "$TMP/$name.requests"; return 1; }
    local leaves=1
    [[ "$name" != main-id-unrelated ]] || leaves=0
    [[ $(awk '$1=="DELETE" && $2=="/islands/33333333-3333-4333-8333-333333333333/memberships/me"{n++}END{print n+0}' "$TMP/$name.requests") == "$leaves" ]] || { cat "$TMP/$name.log" "$TMP/$name.requests"; return 1; }
    if [[ "$name" == main-cleanup-fails || "$name" == main-cleanup-append ]]; then
      awk -F '\t' '$1=="SMOKE-SERVER-004" && $2=="FAIL" && $5~/정리 실패/{ok=1} END{exit !ok}' "$TMP/$name.tsv"
      local expected_rows=1
      [[ "$name" != main-cleanup-append ]] || expected_rows=2
      [[ $(awk -F '\t' '$1=="SMOKE-SERVER-004"{n++}END{print n}' "$TMP/$name.tsv") == "$expected_rows" ]] || { cat "$TMP/$name.tsv"; return 1; }
      if [[ "$name" == main-cleanup-append ]]; then
        awk -F '\t' '$1=="SMOKE-SERVER-004" && $2=="PASS" && $5=="이전 실행"{ok=1} END{exit !ok}' "$TMP/$name.tsv" || { cat "$TMP/$name.tsv"; return 1; }
      fi
    elif [[ "$name" == main-intermediate-fails ]]; then
      awk -F '\t' '$1=="SMOKE-SERVER-005" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
    elif [[ "$name" == main-id-* ]]; then
      awk -F '\t' '$1=="SMOKE-SERVER-004" && $2=="FAIL" && $5~/수동 확인 필요/{ok=1} END{exit !ok}' "$TMP/$name.tsv"
    fi
  elif [[ "$name" == friend-id-* ]];then
    awk -F '\t' '$1=="SMOKE-SERVER-016" && $2=="FAIL" && $5~/수동 확인 필요/{ok=1} END{exit !ok}' "$TMP/$name.tsv" || { cat "$TMP/$name.tsv"; return 1; }
    local leaves=1
    [[ "$name" != friend-id-unrelated ]] || leaves=0
    [[ $(awk '$1=="DELETE" && $2=="/islands/33333333-3333-4333-8333-333333333333/memberships/me"{n++}END{print n+0}' "$TMP/$name.requests") == "$leaves" ]] || { cat "$TMP/$name.requests"; return 1; }
  else
    awk -F '\t' '$1=="SMOKE-SERVER-015" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  fi
  if [[ "$name" == success ]]; then
    [[ $(rg -c '^DELETE /islands/33333333-3333-4333-8333-333333333333/memberships/me$' "$TMP/$name.requests") == 2 ]]
  fi
  python3 - "$TMP/$name.log" "$TMP/$name.tsv" "$TMP/argv.log" <<'PY'
from pathlib import Path
import re
import sys
if any(re.search(r'secret-refresh|secret-bootstrap|secret-ownership|header\.', Path(path).read_text())
       for path in sys.argv[1:]):
    raise SystemExit('credential leaked')
PY
  kill "$PID"; wait "$PID" 2>/dev/null || true; PID='';rm "$TMP/port"
  printf '%s PASS\n' "$name"
}
run_case success '' '' '' 0
run_case health 1 '' '' 1
run_case event '' 1 '' 1
run_case statistics '' '' 1 1
run_case basic '' '' '' 0 1

run_case ownership-invalid '' '' '' 1 1 not-a-uuid
run_case ownership-empty '' '' '' 1 1 ''
run_case ownership-short '' '' '' 1 1 1-1-1-1-1
MOCK_GUEST_FAILURES=1 run_case guest-retry '' '' '' 0 1
MOCK_NO_ISLAND=1 run_case main-created '' '' '' 0 1
MOCK_NO_ISLAND=1 MOCK_LEAVE_FAIL=1 run_case main-cleanup-fails '' '' '' 1 1
MOCK_NO_ISLAND=1 MOCK_LEAVE_FAIL=1 SMOKE_APPEND_RESULTS=1 run_case main-cleanup-append '' '' '' 1 1
MOCK_NO_ISLAND=1 MOCK_FAIL_AFTER_ISLAND=1 run_case main-intermediate-fails '' '' '' 1 1
MOCK_NO_ISLAND=1 MOCK_CREATE_ID_MISSING=1 run_case main-id-missing '' '' '' 1 1
MOCK_NO_ISLAND=1 MOCK_CREATE_ID_MISSING=1 MOCK_RECOVERY_UNRELATED=1 run_case main-id-unrelated '' '' '' 1 1
MOCK_CREATE_ID_MISSING=1 run_case friend-id-missing '' '' '' 1
MOCK_CREATE_ID_MISSING=1 MOCK_RECOVERY_UNRELATED=1 run_case friend-id-unrelated '' '' '' 1
MOCK_NO_CONTEXT=1 MOCK_SEED_SUCCESS=1 run_case statistics-created '' '' '' 1 0 66666666-6666-4666-8666-666666666666 1
run_child_failure() {
  local name=$1 script=$2 leaves=${3:-1} port actual
  MOCK_REQUEST_LOG="$TMP/$name.requests" node "$HERE/tests/mock-api.mjs" "$TMP/port" & PID=$!
  for ((i=0;i<100;i++));do [[ -s "$TMP/port" ]] && break; sleep .02;done
  port=$(cat "$TMP/port")
  set +e
  BASE_URL="http://127.0.0.1:$port" SMOKE_CORE_CONTEXT_FILE="$TMP/$name-context.json" RESULTS_FILE="$TMP/$name.tsv" "$TMP/runner/$script" > "$TMP/$name.log" 2>&1
  actual=$?
  set -e
  [[ "$actual" == 1 ]] || { cat "$TMP/$name.log"; return 1; }
  [[ $(rg -c '^POST /islands$' "$TMP/$name.requests") == 1 ]] || { cat "$TMP/$name.requests"; return 1; }
  [[ $(awk '$1=="DELETE" && $2=="/islands/33333333-3333-4333-8333-333333333333/memberships/me"{n++}END{print n+0}' "$TMP/$name.requests") == "$leaves" ]] || { cat "$TMP/$name.log" "$TMP/$name.requests"; return 1; }
  [[ ! -f "$TMP/$name-context.json" ]]
  if [[ "$name" == core-* ]]; then
    awk -F '\t' '$1=="SMOKE-SERVER-014" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  fi
  if [[ "$leaves" == 0 ]]; then rg -q '수동 확인 필요' "$TMP/$name.log" || { cat "$TMP/$name.log"; return 1; }; fi
  kill "$PID"; wait "$PID" 2>/dev/null || true; PID='';rm "$TMP/port"
  printf '%s PASS\n' "$name"
}
run_child_failure core-seed-fails core-flow.sh
run_child_failure statistics-seed-fails prepare-statistics.sh
MOCK_CREATE_ID_MISSING=1 run_child_failure core-id-missing core-flow.sh
MOCK_CREATE_ID_MISSING=1 run_child_failure statistics-id-missing prepare-statistics.sh
MOCK_CREATE_ID_MISSING=1 MOCK_RECOVERY_UNRELATED=1 run_child_failure core-id-unrelated core-flow.sh 0
MOCK_CREATE_ID_MISSING=1 MOCK_RECOVERY_UNRELATED=1 run_child_failure statistics-id-unrelated prepare-statistics.sh 0
