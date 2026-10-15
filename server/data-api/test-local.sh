#!/usr/bin/env bash
set -e

# PostgreSQL 컨테이너 시작
docker run -d --name test-postgres \
  -e POSTGRES_DB=tt_db \
  -e POSTGRES_USER=ci \
  -e POSTGRES_PASSWORD=ci \
  -p 5432:5432 \
  --health-cmd "pg_isready -U ci -d tt_db" \
  postgres:16-alpine 2>/dev/null || echo "이미 실행 중"

# 헬스체크 대기
echo "PostgreSQL 대기 중..."
until docker exec test-postgres pg_isready -U ci -d tt_db > /dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL 준비 완료"

# 테스트 실행
SPRING_PROFILES_ACTIVE=ci ./gradlew test "${@}"

# 컨테이너 정리
docker stop test-postgres && docker rm test-postgres
