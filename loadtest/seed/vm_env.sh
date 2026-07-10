#!/usr/bin/env bash
# 관측 VM 에서 source — DB 접속 env 를 VM 이 자기 SA 권한으로 스스로 조회한다.
# 시크릿이 ssh --command 인라인 인용(작은따옴표 취약)이나 scp 파일로 랩탑/러너를 경유하지 않음
# (#179 리뷰 2 — fetch-env.sh 와 같은 원칙).
PROJECT_ID=$(curl -s -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/project/project-id)

export DB_HOST="${DB_HOST:-$(gcloud sql instances describe "${SQL_INSTANCE:-loadtest-pg}" \
  --project="$PROJECT_ID" --format='value(ipAddresses[0].ipAddress)')}"
export DB_USER="${DB_USER:-loadtest}"
DB_PASSWORD="$(gcloud secrets versions access latest --secret=loadtest-db-password --project="$PROJECT_ID")"
export DB_PASSWORD
export PGPASSWORD="$DB_PASSWORD"
