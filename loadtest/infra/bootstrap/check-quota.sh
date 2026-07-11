#!/usr/bin/env bash
# GROMO-548/763 부하테스트 쿼터 사전 점검
#
# 필요 동시 vCPU (전역 CPUS_ALL_REGIONS 가 실질 상한):
#   SUT   n2-standard-2  = 2 (온디맨드, N2)
#   관측  e2-small       = 2 (온디맨드, E2)
#   러너  e2-standard-2  = 2 (온디맨드, E2 — 원격 트리거 시 상주)
#   부하  n2-highcpu-4   = 4 × SPOTS (spot, N2 — GROMO-763 수평 확장, SPOTS≤6)
#
# 사용: PROJECT_ID=gromo-loadtest-1 [SPOTS=6] ./check-quota.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?PROJECT_ID를 지정하세요}"
REGION="${REGION:-asia-northeast3}"
SPOTS="${SPOTS:-1}"
{ [[ "$SPOTS" =~ ^[0-9]+$ ]] && [ "$SPOTS" -ge 1 ] && [ "$SPOTS" -le 6 ]; } || { echo "SPOTS 는 1..6"; exit 1; }
LG_CPUS=$((4 * SPOTS)) # n2-highcpu-4 × SPOTS
NEED_CPUS=$((6 + LG_CPUS)) # SUT2 + 관측2 + 러너2 + 부하

echo "[check-quota] ${PROJECT_ID} / ${REGION} (SPOTS=${SPOTS} → 부하 ${LG_CPUS}vCPU, 동시 총 ${NEED_CPUS}vCPU)"

QUOTAS_JSON=$(gcloud compute regions describe "$REGION" --project="$PROJECT_ID" --format=json)

# metric별 남은 여유(limit-usage)를 확인한다. 반환: "limit usage" 두 값.
remaining() {
  python3 - "$1" <<'PY' "$2"
import json, sys
metric = sys.argv[1]
data = json.loads(sys.argv[2])
for q in data.get("quotas", []):
    if q["metric"] == metric:
        print(f'{q["limit"]:.0f} {q["usage"]:.0f}')
        break
else:
    print("absent absent")
PY
}

FAIL=0
check() { # check <metric> <필요 여유> <설명> [json] [soft]
  local metric=$1 need=$2 desc=$3 json=${4:-$QUOTAS_JSON} soft=${5:-}
  read -r limit usage <<<"$(remaining "$metric" "$json")"
  if [ "$limit" = "absent" ]; then
    echo "  - ${metric}: (미노출) — ${desc}"
    return 0
  fi
  local avail=$((limit - usage))
  if [ "$avail" -ge "$need" ]; then
    echo "  ✅ ${metric}: 여유 ${avail} (limit ${limit}) ≥ 필요 ${need} — ${desc}"
  elif [ -n "$soft" ]; then
    echo "  ⚠️  ${metric}: 여유 ${avail} (limit ${limit}) < ${need} — ${desc}"
  else
    echo "  ❌ ${metric}: 여유 ${avail} (limit ${limit}) < 필요 ${need} — ${desc}"
    FAIL=1
  fi
}

# 전역(all-regions) CPU — 무료/기본 계정의 실질 상한. regions describe 엔 없어 project-info 로 별도 조회.
# 리전 CPUS 여유가 커도(예: 100) 전역이 막으면 생성 실패하므로 이걸 가장 먼저 본다.
echo "[check-quota] 전역 상한"
GLOBAL_JSON=$(gcloud compute project-info describe --project="$PROJECT_ID" --format=json)
check CPUS_ALL_REGIONS "$NEED_CPUS" "전역 동시 vCPU — 실질 상한(리전과 별개)" "$GLOBAL_JSON"

echo "[check-quota] 리전 쿼터"
check CPUS             "$NEED_CPUS"    "리전 온디맨드 vCPU (SUT2 + 관측2 + 러너2 + 부하 4×${SPOTS})"
check N2_CPUS          $((2 + LG_CPUS)) "N2 vCPU (SUT n2-standard-2 + 부하 n2-highcpu-4×${SPOTS})"
# GROMO-763: 부하를 n2-highcpu-4 로 전환 → C2_CPUS 검사 제거. spot 도 N2_CPUS/CPUS 로 검사됨.
check PREEMPTIBLE_CPUS "$LG_CPUS"      "spot 참고용 legacy metric — 실제 검사는 N2_CPUS/CPUS" "$QUOTAS_JSON" soft
check IN_USE_ADDRESSES $((3 + SPOTS))  "외부 IP (SUT·관측·러너 + 부하 ${SPOTS})"
check DISKS_TOTAL_GB   $((80 + 20 * SPOTS)) "PD 용량 (SUT20 + 관측30 + 러너 여유 + 부하 20×${SPOTS})"

echo
if [ "$FAIL" -eq 1 ]; then
  cat <<EOF
[check-quota] ❌ 부족한 쿼터가 있습니다.
  증설 요청: https://console.cloud.google.com/iam-admin/quotas?project=${PROJECT_ID}
  (metric 검색 → 상향 요청. 전역 CPUS_ALL_REGIONS 가 실질 상한 — 리전 CPUS 여유가 있어도 전역이 막으면 실패.
   대안: SPOTS 를 낮춰(n2-highcpu-4 × 적은 대수) 예산 안으로 맞추기)
EOF
  exit 1
fi
echo "[check-quota] ✅ 통과 — 다음 단계: make infra-up"
