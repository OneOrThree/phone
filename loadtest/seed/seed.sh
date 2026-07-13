#!/usr/bin/env bash
# golden DB 시드 오케스트레이터 (GROMO-548 M4)
#
# 사용 (랩탑 또는 러너에서):
#   PROJECT_ID=gromo-loadtest-1 ./seed.sh            # full (~6,500만 건, 수십 분)
#   PROJECT_ID=... SCALE=0.01 ./seed.sh              # 파이프라인 디버그용 축소 시드 (분 단위)
#
# 원칙:
#   - DB 는 사설 IP 전용 → 모든 DB 접근은 관측 VM(IAP ssh) 경유. 랩탑/러너는 DB 직통 경로 없음.
#   - 차원 CSV(한글 닉네임·그룹명)는 랩탑에서 node 로 생성 → scp. 팩트는 DB 안에서 generate_series.
#   - 재현성: 결정론 UUID + setseed 고정 + SEED_VERSION 태깅 (버전 다르면 baseline diff 거부).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?}"
ZONE="${ZONE:-asia-northeast3-c}" # a존 stockout 연쇄(07-11~13)로 이동 — common.sh 와 동일 기본값
SCALE="${SCALE:-1}"
SEED_VERSION="${SEED_VERSION:-seed-v1}"
OBS_VM="${OBS_VM:-obs}"
SQL_INSTANCE="${SQL_INSTANCE:-loadtest-pg}"

SEED_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SEED_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/back/src/main/resources/db/migration"
CSV_DIR="$(mktemp -d)/csv"
PARAMS_DIR="$(mktemp -d)/params"
STEP_DIR="$(mktemp -d)/steps"
mkdir -p "$CSV_DIR" "$PARAMS_DIR" "$STEP_DIR"

log() { printf '\n[seed] %s\n' "$*"; }
# keepalive — focus_sessions(수천만 INSERT) 같은 장시간 원격 작업 중 IAP ssh 세션이 끊겨
# psql 이 죽는 것을 방지 (ServerAliveInterval 로 유휴 터널 유지)
run_vm() { gcloud compute ssh "$OBS_VM" --zone="$ZONE" --tunnel-through-iap --project="$PROJECT_ID" \
  --ssh-flag="-o ServerAliveInterval=30" --ssh-flag="-o ServerAliveCountMax=20" --command="$1"; }
scp_to_vm() { gcloud compute scp --zone="$ZONE" --tunnel-through-iap --project="$PROJECT_ID" --recurse "$@"; }

# ── 0. 사전 조건 ─────────────────────────────────────────────
log "Cloud SQL 상태 확인"
SQL_STATE=$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT_ID" --format='value(state)')
if [ "$SQL_STATE" != "RUNNABLE" ]; then
  log "❌ Cloud SQL 이 기동 상태가 아님($SQL_STATE) — 먼저: make up"
  exit 1
fi
# JWT 시크릿만 로컬로(mint 가 랩탑/러너에서 돎). DB 시크릿은 VM 이 vm_env.sh 로 스스로 조회 —
# ssh --command 인라인 인용에 시크릿을 싣지 않는다 (#179 리뷰 2)
JWT_SECRET=$(gcloud secrets versions access latest --secret=loadtest-jwt-secret --project="$PROJECT_ID")

# ── 1. 차원 CSV 생성 (랩탑, node) ────────────────────────────
log "차원 CSV 생성 (SCALE=$SCALE)"
node "$SEED_DIR/10_dimensions.mjs" --scale "$SCALE" --out "$CSV_DIR"

# ── 2. 관측 VM 스테이징 ──────────────────────────────────────
log "관측 VM 준비·파일 전송"
run_vm 'command -v psql >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client)'
run_vm 'rm -rf ~/seed && mkdir -p ~/seed/migration ~/seed/csv ~/seed/params'
scp_to_vm "$SEED_DIR"/*.sh "$SEED_DIR"/*.sql "$OBS_VM":~/seed/
scp_to_vm "$MIGRATIONS_DIR"/*.sql "$OBS_VM":~/seed/migration/
scp_to_vm "$CSV_DIR"/* "$OBS_VM":~/seed/csv/

# VM 쪽 실행 헬퍼 — vm_env.sh 를 source 해 DB_HOST/PGPASSWORD 를 VM 안에서 구성 (인용 안전)
vm_sh()  { run_vm ". ~/seed/vm_env.sh && $1"; }
VM_PSQL='psql -h "$DB_HOST" -U "$DB_USER" -v ON_ERROR_STOP=1'

# 장시간 DB 단계(팩트 생성·제약 복원)를 VM 에서 detached(setsid) 로 실행하고 폴링한다.
# full seed(focus_sessions 3천만)가 조용히 죽던 원인 = 장시간 INSERT 중 IAP ssh 세션이 끊기면
# 포그라운드 원격 psql 이 SIGHUP 으로 종료·롤백되던 것. setsid 로 psql 을 SSH 수명에서 분리하면
# 터널이 끊겨도 VM 안에서 계속 실행된다(폴링 ssh 가 끊겨도 재연결로 무해). rc 파일로 성공/실패 판정.
vm_sh_bg() {
  local tag="$1" inner="$2"
  printf 'set -euo pipefail\n. ~/seed/vm_env.sh\n%s\n' "$inner" > "$STEP_DIR/${tag}.step.sh"
  scp_to_vm "$STEP_DIR/${tag}.step.sh" "$OBS_VM":"~/seed/${tag}.step.sh" >/dev/null
  run_vm "rm -f ~/seed/${tag}.rc ~/seed/${tag}.log; setsid bash -c 'bash ~/seed/${tag}.step.sh; echo \$? > ~/seed/${tag}.rc' </dev/null >~/seed/${tag}.log 2>&1 & sleep 1"
  log "  ↳ ${tag}: VM detached 실행 — 30s 폴링 (ssh 드롭 무관)"
  local waited=0 cap=7200
  while true; do
    if run_vm "test -f ~/seed/${tag}.rc" 2>/dev/null; then break; fi
    if [ "$waited" -ge "$cap" ]; then
      log "❌ ${tag}: ${cap}s 초과 — 중단"; run_vm "tail -n 40 ~/seed/${tag}.log" || true; exit 1
    fi
    run_vm "tail -n 1 ~/seed/${tag}.log 2>/dev/null" 2>/dev/null | sed 's/^/    │ /' || true
    sleep 30; waited=$((waited+30))
  done
  local rc; rc=$(run_vm "cat ~/seed/${tag}.rc" 2>/dev/null | tr -dc '0-9' || true)
  if [ "${rc:-1}" != "0" ]; then
    log "❌ ${tag}: 실패 (rc=${rc:-?}) — 마지막 로그 40줄:"; run_vm "tail -n 40 ~/seed/${tag}.log" || true; exit 1
  fi
  log "  ↳ ${tag}: 완료 (rc=0, ~${waited}s)"
}

# ── 3. 스키마 (Flyway V1~최신) → 4. 차원 → 5. 팩트 → 6. 제약·통계 ──
log "3/8 스키마 — Flyway (docker)"
vm_sh "MIGRATIONS_DIR=~/seed/migration bash ~/seed/00_flyway.sh"

log "4/8 차원 테이블 \\copy"
vm_sh "bash ~/seed/15_copy_dimensions.sh"

log "5/8 팩트 테이블 generate_series (가장 오래 걸리는 단계 — VM detached)"
vm_sh_bg facts "$VM_PSQL -d golden -v scale=$SCALE -f ~/seed/20_facts.sql"

log "6/8 제약·인덱스 복원 + VACUUM ANALYZE (VM detached)"
vm_sh_bg constraints "$VM_PSQL -d golden -f ~/seed/30_constraints_indexes.sql"

# ── 7. params export → mint → GCS ───────────────────────────
log "7/8 params export + JWT mint"
vm_sh "cd ~ && $VM_PSQL -d golden -f ~/seed/40_params_export.sql"
gcloud compute scp --zone="$ZONE" --tunnel-through-iap --project="$PROJECT_ID" --recurse \
  "$OBS_VM":"~/seed/params/*" "$PARAMS_DIR/"
JWT_SECRET="$JWT_SECRET" node "$SEED_DIR/50_mint_jwt.mjs" "$PARAMS_DIR"
gcloud storage cp -r "$PARAMS_DIR"/* "gs://${PROJECT_ID}-params/${SEED_VERSION}/"

# ── 8. 검증 → golden 동결 (동결 후엔 golden 접속 불가라 검증이 선행) ──
log "8/8 검증(95_verify: 건수·크기·커서 정렬·FK 표본) → golden 동결"
vm_sh "$VM_PSQL -d golden -f ~/seed/95_verify.sql"
vm_sh "$VM_PSQL -d postgres -f ~/seed/90_freeze_golden.sql"
cat <<EOF

  SEED_VERSION=${SEED_VERSION} SCALE=${SCALE}
  params: gs://${PROJECT_ID}-params/${SEED_VERSION}/
  다음: make reset (loadtest ← golden 복제) → smoke run
  ※ 위 95_verify 출력에서 건수를 volume.md 와 대조하고 cursor_order_violations=0,
    dangling_tag_refs=0 을 확인할 것
EOF
