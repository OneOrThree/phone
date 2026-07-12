#!/usr/bin/env bash
# 부하 VM 라이프사이클 — spot 이라 run 마다 생성·삭제 (터라폼은 템플릿만 관리).
# GROMO-763: 단일 'loadgen' → SPOTS=N 대(loadgen-0..N-1) 수평 확장.
#   up   : 최신 템플릿으로 N대 병렬 생성 (+MACHINE_TYPE 오버라이드로 머신타입 폴백)
#   down : N대 전수 삭제 (개별 || true 격리 — 한 대 실패로 나머지 미삭제 시 spot 과금 지속)
#   alive: N대 전부 RUNNING 이면 0 — 하나라도 ABSENT(선점 DELETE)면 비-0 = INVALID (all-or-nothing).
#          termination_action=DELETE 라 선점되면 인스턴스가 사라진다 → ABSENT = 선점 의심.
. "$(dirname "$0")/common.sh"
CMD="${1:?사용법: loadgen.sh <up|down|alive>}"
SPOTS="${SPOTS:-1}"   # Makefile 이 export — run.sh 와 동일 파싱

case "$CMD" in
  up)
    TEMPLATE=$(gcloud compute instance-templates list --project="$PROJECT_ID" \
      --filter="name~^loadgen-" --sort-by=~creationTimestamp --limit=1 --format='value(name)')
    [ -n "$TEMPLATE" ] || { log "❌ loadgen 템플릿 없음 — make infra-up 선행"; exit 1; }

    log "spot 부하 VM ${SPOTS}대 생성 (template=$TEMPLATE${MACHINE_TYPE:+, machine=$MACHINE_TYPE})"
    for i in $(seq 0 $((SPOTS - 1))); do
      [ "$(vm_status "loadgen-$i")" = "RUNNING" ] && { log "loadgen-$i 이미 실행 중 (skip)"; continue; }
      # shellcheck disable=SC2086
      gcloud compute instances create "loadgen-$i" \
        --zone="$ZONE" --project="$PROJECT_ID" \
        --source-instance-template="$TEMPLATE" \
        ${MACHINE_TYPE:+--machine-type="$MACHINE_TYPE"} --quiet &
    done
    wait  # 무인자 wait — 모든 create 대기 후 0 반환(set -e 안전). create 실패는 아래 wait_ssh 가 표출.
    for i in $(seq 0 $((SPOTS - 1))); do wait_ssh "loadgen-$i"; done
    log "loadgen ${SPOTS}대 준비 완료"
    ;;

  down)
    for i in $(seq 0 $((SPOTS - 1))); do
      if [ "$(vm_status "loadgen-$i")" != "ABSENT" ]; then
        log "loadgen-$i 삭제"
        # 개별 || true 격리 — 한 대 삭제 실패가 나머지 삭제를 막지 않게(spot 과금 차단).
        gcloud compute instances delete "loadgen-$i" --zone="$ZONE" --project="$PROJECT_ID" --quiet || true
      fi
    done
    ;;

  alive)
    n=0
    for i in $(seq 0 $((SPOTS - 1))); do
      [ "$(vm_status "loadgen-$i")" = "RUNNING" ] && n=$((n + 1))
    done
    # 전부 RUNNING 이어야 0(통과). 하나라도 죽으면 비-0 → run.sh 가 .preempted (all-or-nothing).
    [ "$n" -eq "$SPOTS" ]
    ;;

  *) echo "unknown: $CMD" >&2; exit 1 ;;
esac
