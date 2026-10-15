#!/usr/bin/env bash
# 컨테이너 상태로 기동 판정. GROMO-2224.
# 사용: wait-healthy.sh <컨테이너> [최대초=900]
# 고정 타이머 대신 Docker 상태로 판단:
#   starting → 대기 · healthy → 통과 · unhealthy·exited·dead·재시작 → 즉시 실패.
# 기동 시간 = 컨테이너 실제 시작(StartedAt) → healthy 확인. 실행 요약과 VM 고정 경로 기록에 남기고
# 직전 5회 평균의 1.5배 넘으면 경고. DEPLOY_STARTED_AT(배포 단계 시작 epoch)보다 먼저 만들어진(Created) 컨테이너는
# 이번에 재생성되지 않은 것(설정 변화 없음) → 기록하지 않음.
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

# 대기 시간이 아니라 컨테이너가 실제로 뜬 시각부터 잼 — 앞 서버를 기다리는 사이 이미 떠 있던 경우도 정확
container_started=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$container")" +%s 2>/dev/null || echo 0)
if (( container_started > 0 )); then startup=$(( $(date +%s) - container_started )); else startup=$elapsed; fi
# 재생성 판정은 생성 시각(Created)으로 — StartedAt 은 재시작마다 바뀌어 기존 컨테이너가 재시작만 해도 새 것으로 오인함
container_created=$(date -d "$(docker inspect -f '{{.Created}}' "$container")" +%s 2>/dev/null || echo 0)
if [ -n "${DEPLOY_STARTED_AT:-}" ] && (( container_created > 0 && container_created < DEPLOY_STARTED_AT )); then
  echo "$container healthy — 이번 배포에서 재생성 안 됨(설정·이미지 변화 없음), 기동 시간 기록 안 함"
  echo "- \`$container\` 재생성 없음 (변화 없음)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi
elapsed=$startup
echo "$container healthy (기동 ${elapsed}s)"
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
