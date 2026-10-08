#!/usr/bin/env bash
# 컨테이너 상태로 기동 판정. GROMO-2224.
# 사용: wait-healthy.sh <컨테이너> [최대초=900]
# 고정 타이머 대신 Docker 상태로 판단:
#   starting → 대기 · healthy → 통과 · unhealthy·exited·dead·재시작 → 즉시 실패.
# 기동 시간은 실행 요약과 VM 고정 경로 기록에 남김. 직전 5회 평균의 1.5배 넘으면 경고.
set -euo pipefail

container=${1:?컨테이너 이름 필요}
limit=${2:-900}
history_dir=${STARTUP_HISTORY_DIR:-/var/lib/gromo/runtime/startup-times}

inspect() {
  docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$container"
}
# 방금 만든 컨테이너(30분 안)인데 이미 재시작했다면 기동 중 크래시 — 스크립트 시작 전에 일어난 재시작도 잡음.
# 오래된 컨테이너(설정이 같아 재생성 안 된 경우)는 과거 재시작을 문제 삼지 않음
fresh_restarts() {
  local created
  created=$(date -d "$(docker inspect -f '{{.Created}}' "$container")" +%s 2>/dev/null) || return 1
  (( $(date +%s) - created < 1800 ))
}

fail() {
  echo "::error::$container $1"
  docker logs --tail=100 "$container" 2>&1 || true
  exit 1
}

state=$(inspect 2>/dev/null) || fail "컨테이너 없음"
read -r _ _ restarts_before <<< "$state"
if (( restarts_before > 0 )) && fresh_restarts; then
  fail "새 컨테이너가 헬스체크 전에 이미 ${restarts_before}번 재시작함 (기동 중 크래시)"
fi
started=$SECONDS
while :; do
  state=$(inspect 2>/dev/null) || fail "컨테이너가 사라짐"
  read -r status health restarts <<< "$state"
  elapsed=$((SECONDS - started))
  case "$status" in
    exited|dead) fail "종료됨 (status=$status, ${elapsed}s)" ;;
    restarting) fail "재시작 반복 중 (${elapsed}s)" ;;
  esac
  [ "$restarts" = "$restarts_before" ] || fail "기동 중 재시작 발생 (restart $restarts_before → $restarts)"
  case "$health" in
    healthy) break ;;
    unhealthy) fail "unhealthy (${elapsed}s)" ;;
    none) fail "healthcheck 가 정의되지 않음 — compose 에 healthcheck 필요" ;;
  esac
  (( elapsed < limit )) || fail "${limit}s 안에 healthy 안 됨 (health=$health)"
  if (( elapsed > 0 && elapsed % 60 < 5 )); then echo "$container health=$health 대기 ${elapsed}s"; fi
  sleep 5
done

echo "$container healthy (${elapsed}s)"
note=""
if mkdir -p "$history_dir" 2>/dev/null && [ -w "$history_dir" ]; then
  log="$history_dir/$container.log"
  avg=$( (tail -n 5 "$log" 2>/dev/null || true) | awk '{s+=$2; n++} END {if (n) printf "%d", s/n}')
  if [ -n "$avg" ] && (( avg > 0 && elapsed * 2 > avg * 3 )); then
    echo "::warning::$container 기동 ${elapsed}s — 직전 5회 평균 ${avg}s 의 1.5배 초과. 메모리 등 서버 상태 확인"
    note=" ⚠️ 평균 ${avg}s"
  elif [ -n "$avg" ]; then
    note=" (평균 ${avg}s)"
  fi
  echo "$(date -u +%FT%TZ) $elapsed ${IMAGE_REVISION:-}" >> "$log"
fi
echo "- \`$container\` 기동 ${elapsed}s$note" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
