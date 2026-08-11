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

for required_command in docker curl npm lsof; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "필수 명령을 찾을 수 없습니다: $required_command"
    exit 1
  fi
done

echo "1/4 Docker PostgreSQL을 준비합니다."
docker compose -f "$compose_file" up -d --wait

if [[ ! -f "$local_config" ]]; then
  cp "$local_config_example" "$local_config"
else
  # 예제보다 먼저 만들어 둔 application-local.yml 은 이번에 추가된 키가 없을 수 있다.
  # 기본값 없는 @Value 라 하나만 빠져도 부팅 중에 죽으므로(placeholder 미해결) 먼저 잡는다.
  # 개인 설정 파일이라 자동으로 고치지 않고, 무엇을 채워야 하는지 알려주고 멈춘다.
  missing_keys=()
  for required_key in jwt kakao apple google line instagram facebook link; do
    grep -q "^${required_key}:" "$local_config" || missing_keys+=("$required_key")
  done
  if [[ ${#missing_keys[@]} -gt 0 ]]; then
    echo "application-local.yml 에 다음 설정이 없습니다: ${missing_keys[*]}"
    echo "  파일: $local_config"
    echo "  예제: $local_config_example — 위 키 블록을 그대로 복사해 넣으세요."
    echo "  (없으면 백엔드가 Could not resolve placeholder 로 부팅에 실패합니다)"
    exit 1
  fi
fi

if curl --connect-timeout 1 --silent --fail --output /dev/null \
  http://127.0.0.1:8080/swagger-ui/index.html; then
  # 8080 에 응답이 있다고 그게 이 저장소의 local 프로파일 백엔드라는 보장은 없다.
  # 다른 프로파일·다른 DB 를 보는 인스턴스면 시드는 phone-db-local 에 들어가는데 웹 요청은
  # 그쪽 DB 로 가서 더미 데이터가 안 보인다 — 조용히 그렇게 되느니 멈추고 알린다(코드리뷰).
  if [[ "${LOCAL_WEB_REUSE_BACKEND:-}" != "1" ]]; then
    echo "8080 포트에 이미 다른 프로세스가 응답하고 있습니다."
    echo "  그 백엔드가 이 저장소의 local 프로파일이 아니면, 시드는 phone-db-local 에 들어가고"
    echo "  웹 요청은 그 백엔드의 DB 로 가서 더미 데이터가 보이지 않습니다."
    echo "  → 그 프로세스를 내리고 다시 실행하거나,"
    echo "    로컬 백엔드가 맞다면 LOCAL_WEB_REUSE_BACKEND=1 $0 로 실행하세요."
    exit 1
  fi
  echo "2/4 이미 실행 중인 백엔드를 재사용합니다(LOCAL_WEB_REUSE_BACKEND=1)."
else
  echo "2/4 로컬 백엔드를 시작합니다. 로그: $backend_log"
  mkdir -p "$(dirname "$backend_log")"
  (
    cd "$repo_root/back"
    # local 프로파일을 명시해야 application-local.yml(jwt·소셜 설정)과 LocalCorsConfig 가 붙는다.
    # 저장소에 base application.yml 이 없어(gitignore) 프로파일을 안 주면 default 로 떠서
    # "Could not resolve placeholder 'jwt.secret'" 으로 부팅에 실패한다.
    SPRING_PROFILES_ACTIVE=local ./gradlew bootRun
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
