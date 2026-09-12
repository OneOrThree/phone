#!/bin/bash
# CI와 동일한 검사를 로컬에서 실행 (realtime-ci.yml)
#
# realtime 은 be-*.yml 재사용 워크플로를 쓰지 않는다 — 그쪽이
# `working-directory: server/data-api` 를 하드코딩하고 있기 때문이다.
# CI 는 잡 하나에서 `./gradlew build` 한 번으로 checkstyle · spotbugs · test · bootJar
# 를 전부 돈다. 여기서도 같은 한 줄을 쓴다 — 나누면 CI 와 달라진다.
#
# Postgres·Redis 는 띄우지 않는다. 테스트가 Testcontainers 로 직접 띄우고
# @ServiceConnection 이 주소를 빈으로 주입한다. 대신 Docker 는 떠 있어야 한다.

set -e

cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
    echo "Docker 가 떠 있지 않다 — Testcontainers 가 기동하지 못한다." >&2
    exit 1
fi

echo "=========================================="
echo " realtime  ./gradlew build"
echo "   (checkstyle · spotbugs · test · bootJar)"
echo "=========================================="
SPRING_PROFILES_ACTIVE=ci ./gradlew build --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
