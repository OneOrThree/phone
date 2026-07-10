#!/usr/bin/env bash
# GROMO-548 부하테스트 리전 쿼터 사전 점검
#
# 필요 동시 vCPU (무료체험 상한 8 안에서의 예산):
#   SUT   n2-standard-2  = 2 (온디맨드, N2)
#   관측  e2-small       = 2 (온디맨드, E2 → 공용 CPUS)
#   부하  c2-standard-4  = 4 (spot, C2 — 폴백 n2-highcpu-4)
#
# 사용: PROJECT_ID=gromo-loadtest-1 ./check-quota.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?PROJECT_ID를 지정하세요}"
REGION="${REGION:-asia-northeast3}"

echo "[check-quota] ${PROJECT_ID} / ${REGION}"

QUOTAS_JSON=$(gcloud compute regions describe "$REGION" --project="$PROJECT_ID" --format=json)

# metric별 남은 여유(limit-usage)를 확인한다. 반환: "limit usage" 두 값.
remaining() {
  python3 - "$1" <<'PY' "$QUOTAS_JSON"
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
check() { # check <metric> <필요 여유> <설명>
  local metric=$1 need=$2 desc=$3
  read -r limit usage <<<"$(remaining "$metric")"
  if [ "$limit" = "absent" ]; then
    echo "  - ${metric}: (미노출) — ${desc} → 공용 CPUS로 합산 확인 필요"
    return 0
  fi
  local avail=$((limit - usage))
  if [ "$avail" -ge "$need" ]; then
    echo "  ✅ ${metric}: 여유 ${avail} (limit ${limit}) ≥ 필요 ${need} — ${desc}"
  else
    echo "  ❌ ${metric}: 여유 ${avail} (limit ${limit}) < 필요 ${need} — ${desc}"
    FAIL=1
  fi
}

echo "[check-quota] 필수 쿼터"
check CPUS               4 "온디맨드 vCPU (SUT 2 + 관측 2)"
check N2_CPUS            6 "N2 vCPU (SUT n2-standard-2 + 폴백 n2-highcpu-4 동시 대비)"
check C2_CPUS            4 "C2 vCPU (부하 c2-standard-4)"
check PREEMPTIBLE_CPUS   4 "spot vCPU (부하 VM — 미노출이면 CPUS에 합산됨)"
check IN_USE_ADDRESSES   3 "외부 IP (SUT·관측·부하 ephemeral)"
check DISKS_TOTAL_GB   150 "PD 용량 (SUT 20 + 관측 30 + 부하 20 + 여유)"

echo
if [ "$FAIL" -eq 1 ]; then
  cat <<EOF
[check-quota] ❌ 부족한 쿼터가 있습니다.
  증설 요청: https://console.cloud.google.com/iam-admin/quotas?project=${PROJECT_ID}
  (metric 검색 → 상향 요청. 무료체험 계정은 상향이 거부될 수 있음 — 그 경우:
   ① 부하 VM을 n2-highcpu-4로 폴백(MACHINE_TYPE 변수), 또는
   ② 유료 계정 업그레이드 재검토 — 크레딧은 유지되며 먼저 소진됨)
EOF
  exit 1
fi
echo "[check-quota] ✅ 통과 — 다음 단계: make infra-up"
