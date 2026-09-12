#!/bin/bash
# CI와 동일한 검사를 로컬에서 실행 (satellite-ci.yml 의 notification 잡)
#
# CI 는 `./gradlew build --stacktrace` 한 번으로 checkstyle · spotbugs · test · bootJar 를
# 전부 돈다. 여기서도 같은 한 줄을 쓴다 — 태스크를 나눠 부르면 CI 와 달라진다.
#
# business-api 와 달리 컨테이너가 필요 없다(PDF 도구에 의존하지 않는다). 다만 테스트가
# Testcontainers 로 Postgres 를 직접 띄우므로 Docker 는 떠 있어야 한다.

set -e

cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
    echo "Docker 가 떠 있지 않다 — Testcontainers 가 기동하지 못한다." >&2
    exit 1
fi

echo "=========================================="
echo " notification  ./gradlew build"
echo "   (checkstyle · spotbugs · test · bootJar)"
echo "=========================================="
SPRING_PROFILES_ACTIVE=ci ./gradlew build --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
