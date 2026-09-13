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
# clean 을 붙인다. CI 는 깨끗한 체크아웃에서 돌아 언제나 실제로 검사하지만, 로컬은 build/ 가
# 남아 있어 소스가 그대로면 Gradle 이 UP-TO-DATE 로 건너뛴다. 소스가 아니라 «환경»(도커·
# Testcontainers)이 바뀌거나 고장 난 경우에도 입력 해시는 그대로라, 아무 검사도 안 돈 채
# 게이트가 초록이 된다. build 는 라이프사이클 태스크라 --rerun 을 붙일 수 없으므로 CI 와
# 같은 «깨끗한 상태» 를 clean 으로 만든다.
SPRING_PROFILES_ACTIVE=ci ./gradlew clean build --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
