#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="$repo_root/docker-compose.local.yml"
local_config="$repo_root/back/src/main/resources/application-local.yml"
local_config_example="$local_config.example"
backend_log="$repo_root/back/build/local-web-backend.log"
backend_pid=""

cleanup() {
  exit_code=$?
  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    echo "로컬 백엔드를 종료합니다."
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

for required_command in docker curl npm; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "필수 명령을 찾을 수 없습니다: $required_command"
    exit 1
  fi
done

echo "1/4 Docker PostgreSQL을 준비합니다."
docker compose -f "$compose_file" up -d --wait

if [[ ! -f "$local_config" ]]; then
  cp "$local_config_example" "$local_config"
fi

if curl --connect-timeout 1 --silent --fail --output /dev/null \
  http://127.0.0.1:8080/swagger-ui/index.html; then
  echo "2/4 이미 실행 중인 로컬 백엔드를 사용합니다."
else
  echo "2/4 로컬 백엔드를 시작합니다. 로그: $backend_log"
  mkdir -p "$(dirname "$backend_log")"
  (
    cd "$repo_root/back"
    ./gradlew bootRun
  ) >"$backend_log" 2>&1 &
  backend_pid=$!

  backend_ready=false
  for _attempt in {1..120}; do
    if curl --connect-timeout 1 --silent --fail --output /dev/null \
      http://127.0.0.1:8080/swagger-ui/index.html; then
      backend_ready=true
      break
    fi
    if ! kill -0 "$backend_pid" 2>/dev/null; then
      echo "백엔드 시작에 실패했습니다."
      tail -80 "$backend_log"
      exit 1
    fi
    sleep 1
  done

  if [[ "$backend_ready" != true ]]; then
    echo "백엔드가 120초 안에 준비되지 않았습니다."
    tail -80 "$backend_log"
    exit 1
  fi
fi

echo "3/4 반복 실행 가능한 더미 데이터를 넣습니다."
"$repo_root/back/scripts/seed-local-debug.sh"

web_port=8081
while lsof -nP -iTCP:"$web_port" -sTCP:LISTEN >/dev/null 2>&1; do
  web_port=$((web_port + 1))
done

echo "4/4 웹 앱을 시작합니다: http://localhost:$web_port"
echo "종료하려면 Ctrl+C를 누르세요. PostgreSQL 데이터는 유지됩니다."
cd "$repo_root/app"
npm run web -- --port "$web_port"
