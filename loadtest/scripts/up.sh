#!/usr/bin/env bash
# make up — 상시 인프라 기동. 인자:
#   base : Cloud SQL 기동 + sut/obs VM 시작 + sync + 관측 스택 up   (reset 이 가능한 상태)
#   app  : SUT app 기동 (reset 후 — app 이 loadtest DB 에 붙어 있으면 DROP 이 막힌다)
. "$(dirname "$0")/common.sh"
STAGE="${1:?사용법: up.sh <base|app>}"

case "$STAGE" in
  base)
    log "Cloud SQL 기동"
    SQL_STATE=$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT_ID" --format='value(state)')
    if [ "$SQL_STATE" != "RUNNABLE" ]; then
      gcloud sql instances patch "$SQL_INSTANCE" --project="$PROJECT_ID" --activation-policy=ALWAYS --quiet
      until [ "$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT_ID" --format='value(state)')" = "RUNNABLE" ]; do
        sleep 10
      done
    fi

    for vm in sut obs; do
      if [ "$(vm_status "$vm")" != "RUNNING" ]; then
        log "$vm VM 시작"
        gcloud compute instances start "$vm" --zone="$ZONE" --project="$PROJECT_ID" --quiet
      fi
    done
    wait_ssh sut; wait_ssh obs

    "$(dirname "$0")/sync.sh"

    log "관측 스택 up (obs)"
    vm_ssh obs 'cd ~/obs && bash fetch-env.sh obs && sudo docker compose -f docker-compose.obs.yml up -d'
    ;;

  app)
    : "${IMAGE:?IMAGE 필요 — make image 로 빌드·push 후 태그 지정}"
    log "SUT app 기동 (IMAGE=$IMAGE)"
    # Artifact Registry 자격을 root(sudo docker 용)에 설정 — sudo docker 가 root 의 config 를 참조
    vm_ssh sut "sudo gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet"
    vm_ssh sut "cd ~/sut && IMAGE='$IMAGE' bash fetch-env.sh sut && sudo docker compose -f docker-compose.sut.yml pull -q app && sudo docker compose -f docker-compose.sut.yml up -d"

    log "/health 대기 (Flyway·JPA validate 포함 최대 2분)"
    tries=0
    until vm_ssh sut 'curl -fsS http://localhost:8080/health >/dev/null' 2>/dev/null; do
      tries=$((tries + 1))
      [ "$tries" -ge 24 ] && { log "❌ /health 대기 초과 — vm_ssh sut 'docker logs loadtest-app' 확인"; exit 1; }
      sleep 5
    done
    log "SUT 준비 완료 ✅"
    ;;

  *) echo "unknown stage: $STAGE" >&2; exit 1 ;;
esac
