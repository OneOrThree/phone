#!/usr/bin/env bash
# 부하 VM 라이프사이클 — spot 이라 run 마다 생성·삭제 (터라폼은 템플릿만 관리).
#   up   : 최신 loadgen 템플릿으로 `loadgen` 생성 (+MACHINE_TYPE 오버라이드로 n2-highcpu-4 폴백)
#   down : 삭제
#   alive: 존재+RUNNING 이면 0 — run 후 선점 여부 판정에 사용 (termination_action=DELETE 라
#          선점되면 인스턴스가 사라진다 → ABSENT = 선점 의심 = INVALID)
. "$(dirname "$0")/common.sh"
CMD="${1:?사용법: loadgen.sh <up|down|alive>}"

case "$CMD" in
  up)
    if [ "$(vm_status loadgen)" = "RUNNING" ]; then
      log "loadgen 이미 실행 중 (skip)"
      exit 0
    fi
    TEMPLATE=$(gcloud compute instance-templates list --project="$PROJECT_ID" \
      --filter="name~^loadgen-" --sort-by=~creationTimestamp --limit=1 --format='value(name)')
    [ -n "$TEMPLATE" ] || { log "❌ loadgen 템플릿 없음 — make infra-up 선행"; exit 1; }

    log "spot 부하 VM 생성 (template=$TEMPLATE${MACHINE_TYPE:+, machine=$MACHINE_TYPE})"
    # shellcheck disable=SC2086
    gcloud compute instances create loadgen \
      --zone="$ZONE" --project="$PROJECT_ID" \
      --source-instance-template="$TEMPLATE" \
      ${MACHINE_TYPE:+--machine-type="$MACHINE_TYPE"} --quiet
    wait_ssh loadgen
    log "loadgen 준비 완료"
    ;;

  down)
    if [ "$(vm_status loadgen)" != "ABSENT" ]; then
      log "loadgen 삭제"
      gcloud compute instances delete loadgen --zone="$ZONE" --project="$PROJECT_ID" --quiet
    fi
    ;;

  alive)
    [ "$(vm_status loadgen)" = "RUNNING" ]
    ;;

  *) echo "unknown: $CMD" >&2; exit 1 ;;
esac
