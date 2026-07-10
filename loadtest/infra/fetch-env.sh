#!/usr/bin/env bash
# VM 에서 실행 — Secret Manager·Cloud SQL 정보를 .env(0600)로 물질화해 compose 에 주입.
# make up 이 각 VM 에 이 파일을 보내 실행한다. VM SA(loadtest-runner)의 권한으로 접근하므로
# 랩탑/러너에서 시크릿을 평문으로 나르지 않는다.
#
# 사용: [IMAGE=<sut 이미지>] ./fetch-env.sh <sut|obs>
set -euo pipefail

ROLE="${1:?사용법: fetch-env.sh <sut|obs>}"
# -f: 메타데이터 조회 실패 시 빈 값으로 진행하지 않고 즉시 에러 (#180 리뷰)
PROJECT_ID=$(curl -sf -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/project/project-id)
SQL_INSTANCE="${SQL_INSTANCE:-loadtest-pg}"

SQL_IP=$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT_ID" \
  --format='value(ipAddresses[0].ipAddress)')
DB_PASSWORD=$(gcloud secrets versions access latest --secret=loadtest-db-password --project="$PROJECT_ID")

case "$ROLE" in
  sut)
    JWT_SECRET=$(gcloud secrets versions access latest --secret=loadtest-jwt-secret --project="$PROJECT_ID")
    : "${IMAGE:?IMAGE env 필요 — make up 이 Artifact Registry 이미지(:sha)를 주입}"
    cat > .env <<EOF
IMAGE=${IMAGE}
DB_URL=jdbc:postgresql://${SQL_IP}:5432/loadtest
DB_USERNAME=loadtest
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
EOF
    ;;
  obs)
    cat > .env <<EOF
SQL_IP=${SQL_IP}
DB_PASSWORD=${DB_PASSWORD}
EOF
    ;;
  *)
    echo "unknown role: $ROLE" >&2; exit 1 ;;
esac

chmod 600 .env
echo "[fetch-env] $ROLE .env 생성 완료 (SQL_IP=${SQL_IP})"
