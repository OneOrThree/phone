#!/usr/bin/env bash
# GROMO-548 부하테스트 GCP 프로젝트 1회 부트스트랩 (멱등 — 재실행 안전)
#
# 사용:
#   PROJECT_ID=gromo-loadtest-1 BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX ./bootstrap.sh
#
# 하는 일:
#   1. 프로젝트 생성 + 빌링 연결
#   2. 필요 API 활성화
#   3. Terraform 상태 버킷 (버저닝)
#   4. loadtest-runner 서비스 계정 + 역할 바인딩
#   5. Workload Identity Federation (GitHub Actions OIDC 신뢰 — 이 레포 한정)
#   6. budget alert ($300 크레딧의 25/50/75/90%)
#   7. GitHub 레포 설정에 넣을 값 출력
#
# 사전 준비·수동 단계는 README.md 참고.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?PROJECT_ID를 지정하세요 (예: gromo-loadtest-1)}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-}"
REGION="${REGION:-asia-northeast3}"
GITHUB_REPO="${GITHUB_REPO:-OneOrThree/phone}"
GITHUB_REF="${GITHUB_REF:-refs/heads/main}" # loadtest.yml 은 main 에서 dispatch — 그 외 브랜치/워크플로우는 토큰 발급 불가

SA_NAME="loadtest-runner"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_ID="github-pool"
PROVIDER_ID="github-provider"
STATE_BUCKET="${PROJECT_ID}-tf-state"

log() { printf '\n[bootstrap] %s\n' "$*"; }

# ── 1. 프로젝트 ──────────────────────────────────────────────
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  log "프로젝트 존재: $PROJECT_ID (skip)"
else
  log "프로젝트 생성: $PROJECT_ID"
  gcloud projects create "$PROJECT_ID"
fi
gcloud config set project "$PROJECT_ID" >/dev/null

# ── 2. 빌링 ─────────────────────────────────────────────────
if [ -n "$BILLING_ACCOUNT_ID" ]; then
  log "빌링 연결: $BILLING_ACCOUNT_ID"
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID" >/dev/null
fi
BILLING_ENABLED=$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || echo "False")
if [ "$BILLING_ENABLED" != "True" ]; then
  log "⚠️  빌링 미연결. BILLING_ACCOUNT_ID를 지정하거나 콘솔에서 연결 후 재실행:"
  log "   https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
  log "   (빌링 계정 ID 확인: gcloud billing accounts list)"
  exit 1
fi

# ── 3. API 활성화 ────────────────────────────────────────────
log "API 활성화 (수 분 걸릴 수 있음)"
gcloud services enable \
  compute.googleapis.com \
  sqladmin.googleapis.com \
  servicenetworking.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  storage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  cloudbilling.googleapis.com \
  billingbudgets.googleapis.com \
  monitoring.googleapis.com \
  artifactregistry.googleapis.com

# ── 4. Terraform 상태 버킷 ───────────────────────────────────
if gcloud storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  log "TF 상태 버킷 존재: gs://${STATE_BUCKET} (skip)"
else
  log "TF 상태 버킷 생성: gs://${STATE_BUCKET}"
  gcloud storage buckets create "gs://${STATE_BUCKET}" \
    --location="$REGION" --uniform-bucket-level-access
fi
gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning >/dev/null

# ── 5. 서비스 계정 + 역할 ────────────────────────────────────
if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  log "SA 존재: $SA_EMAIL (skip)"
else
  log "SA 생성: $SA_EMAIL"
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="loadtest harness (terraform + run orchestration)"
fi

# 전용 프로젝트라 admin 계열을 허용 — blast radius는 이 프로젝트로 한정.
# VM들도 이 SA로 실행(별도 VM SA를 만들지 않는 MVP 단순화 — README 참고).
ROLES=(
  roles/compute.admin                    # VM·템플릿·방화벽·네트워크
  roles/cloudsql.admin                   # Cloud SQL 인스턴스·DB·플래그
  roles/secretmanager.admin              # terraform이 시크릿 생성 + run이 접근
  roles/storage.admin                    # tf-state·params·reports 버킷
  roles/artifactregistry.admin           # SUT 이미지 저장소 생성·push
  roles/iam.serviceAccountUser           # VM에 SA 부착
  roles/iap.tunnelResourceAccessor       # IAP ssh (러너/랩탑 → VM)
  roles/servicenetworking.networksAdmin  # Private Service Access (Cloud SQL 사설 IP)
  roles/monitoring.viewer                # 부하기 CPU 가드 조회
  roles/serviceusage.serviceUsageConsumer
)
log "역할 바인딩 (${#ROLES[@]}종)"
for role in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$role" \
    --condition=None --quiet >/dev/null
done

# ── 6. Workload Identity Federation ─────────────────────────
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

if gcloud iam workload-identity-pools describe "$POOL_ID" --location=global >/dev/null 2>&1; then
  log "WIF 풀 존재: $POOL_ID (skip)"
else
  log "WIF 풀 생성: $POOL_ID"
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global --display-name="GitHub Actions"
fi

if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
     --workload-identity-pool="$POOL_ID" --location=global >/dev/null 2>&1; then
  log "WIF 프로바이더 존재: $PROVIDER_ID (skip)"
else
  # 신뢰 범위를 레포 + ref(main) 로 이중 한정 — 레포 조건만 두면 "PR 로 워크플로우를 추가할 수 있는
  # 누구나"가 같은 repository 클레임의 토큰으로 SA 를 가장할 수 있다 (#175 리뷰 반영)
  log "WIF 프로바이더 생성: $PROVIDER_ID (신뢰 대상: ${GITHUB_REPO} @ ${GITHUB_REF} 한정)"
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" --location=global \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}' && assertion.ref=='${GITHUB_REF}'"
fi

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

# ── 7. budget alert ($300 크레딧 기준 25/50/75/90%) ──────────
BUDGET_NAME="loadtest-credit-guard"
BILLING_ACCOUNT=$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)') # billingAccounts/XXXX
if gcloud billing budgets list --billing-account="${BILLING_ACCOUNT#billingAccounts/}" \
     --format='value(displayName)' 2>/dev/null | grep -qx "$BUDGET_NAME"; then
  log "budget 존재: $BUDGET_NAME (skip)"
else
  log "budget alert 생성: \$300 기준 25/50/75/90%"
  gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT#billingAccounts/}" \
    --display-name="$BUDGET_NAME" \
    --budget-amount=300USD \
    --threshold-rule=percent=0.25 --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.75 --threshold-rule=percent=0.9 \
    --filter-projects="projects/${PROJECT_NUMBER}" \
    || log "⚠️  budget 생성 실패 — 콘솔에서 수동 생성: https://console.cloud.google.com/billing/budgets"
fi

# ── 완료: GitHub 설정 값 출력 ────────────────────────────────
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
log "완료 ✅  GitHub 레포 Settings → Secrets and variables → Actions → Variables 에 등록:"
cat <<EOF

  GCP_PROJECT_ID   = ${PROJECT_ID}
  GCP_WIF_PROVIDER = ${WIF_PROVIDER}
  GCP_SA_EMAIL     = ${SA_EMAIL}
  GCP_REGION       = ${REGION}

다음 단계: ./check-quota.sh 로 쿼터 확인 → make infra-up (Terraform)
EOF
