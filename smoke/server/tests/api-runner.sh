#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
PID=''
mkdir "$TMP/runner"
cp "$HERE/run.sh" "$HERE/lib.sh" "$HERE/stomp-connect.mjs" "$TMP/runner/"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/runner/prepare-friendship.sh"
chmod +x "$TMP/runner/prepare-friendship.sh"
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
  local name=$1 health=$2 no_event=$3 bad_screen=$4 expected=$5 basic=${6:-0}
  MOCK_HEALTH_FAIL="$health" MOCK_NO_EVENT="$no_event" MOCK_BAD_SCREEN="$bad_screen" node "$HERE/tests/mock-api.mjs" "$TMP/port" & PID=$!
  for ((i=0;i<100;i++));do [[ -s "$TMP/port" ]] && break; sleep .02;done
  local port;port=$(cat "$TMP/port")
  node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({accessToken:"header."+Buffer.from(JSON.stringify({sid:"55555555-5555-4555-8555-555555555555"})).toString("base64url")+".signature",islandId:"33333333-3333-4333-8333-333333333333"}))' "$TMP/context.json"
  set +e
  SMOKE_BASIC_ONLY="$basic" SMOKE_CORE_ENABLED=0 BASE_URL="http://127.0.0.1:$port" SMOKE_CORE_CONTEXT_FILE="$TMP/context.json" SMOKE_EVENT_TIMEOUT_MS=300 SMOKE_SUBSCRIBE_SETTLE_MS=50 RESULTS_FILE="$TMP/$name.tsv" "$TMP/runner/run.sh" > "$TMP/$name.log" 2>&1
  local actual=$?
  set -e
  [[ "$actual" == "$expected" ]] || { cat "$TMP/$name.log"; return 1; }
  if [[ "$name" == basic ]];then
    [[ $(awk -F '\t' '$2=="PASS"{n++}END{print n}' "$TMP/$name.tsv") == 9 ]] || { cat "$TMP/$name.tsv"; return 1; }
  elif [[ "$name" == success ]];then
    [[ $(awk -F '\t' '$2=="PASS"{n++}END{print n}' "$TMP/$name.tsv") == 11 ]] || { cat "$TMP/$name.tsv"; return 1; }
  elif [[ "$name" == health ]];then
    awk -F '\t' '$1=="SMOKE-SERVER-001" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  elif [[ "$name" == event ]];then
    awk -F '\t' '$1=="SMOKE-SERVER-010" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
    awk -F '\t' '$1=="SMOKE-SERVER-006" && $2=="PASS"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  else
    awk -F '\t' '$1=="SMOKE-SERVER-015" && $2=="FAIL"{ok=1} END{exit !ok}' "$TMP/$name.tsv"
  fi
  if rg 'secret-refresh|secret-bootstrap|secret-ownership|header\.' "$TMP/$name.log" "$TMP/$name.tsv" "$TMP/argv.log";then echo 'credential leaked';return 1;fi
  kill "$PID"; wait "$PID" 2>/dev/null || true; PID='';rm "$TMP/port"
  printf '%s PASS\n' "$name"
}
run_case success '' '' '' 0
run_case health 1 '' '' 1
run_case event '' 1 '' 1
run_case statistics '' '' 1 1
run_case basic '' '' '' 0 1
