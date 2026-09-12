#!/bin/bash
# CI와 동일한 검사를 로컬에서 실행 (satellite-ci.yml 의 business-api 잡)
#
# business-api 는 다른 서버와 달리 «컨테이너 안에서» 검사한다. PDF 미리보기 테스트가
# poppler-utils(pdftotext)·util-linux 에 의존하는데 그건 Dockerfile 의 `test` 스테이지가
# 깔아준다. 호스트에서 곧장 ./gradlew build 를 돌리면 그 도구가 없는 기기에서 조용히
# 다르게 동작한다 — 그래서 CI 와 같은 이미지를 쓴다.
#
# 컨테이너 안 테스트가 다시 Testcontainers 를 띄우므로 docker 소켓을 물려주고,
# TESTCONTAINERS_HOST_OVERRIDE 로 컨테이너에서 본 호스트 주소를 고정한다.

set -e

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
IMAGE="business-api-test:norm-local"
GRADLE_HOME="${TMPDIR:-/tmp}/gradle-business-api-norm"

if ! docker info >/dev/null 2>&1; then
    echo "Docker 가 떠 있지 않다 — business-api 검사는 컨테이너가 필요하다." >&2
    exit 1
fi

cleanup() {
    docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "=========================================="
echo " 1/2  PDF 테스트 도구 이미지 빌드"
echo "=========================================="
docker build --target test -t "$IMAGE" .

echo ""
echo "=========================================="
echo " 2/2  ./gradlew build (컨테이너 안)"
echo "   (checkstyle · spotbugs · test · bootJar)"
echo "=========================================="
mkdir -p "$GRADLE_HOME"

# macOS 의 docker 소켓은 그룹 gid 가 리눅스와 달라 --group-add 가 무의미하거나 실패한다.
# 그래서 CI 처럼 호스트 uid 로 낮추지 않고 컨테이너 기본 사용자로 돈다.
docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$REPO_ROOT:$REPO_ROOT" \
    -v "$GRADLE_HOME:/gradle" \
    -e GRADLE_USER_HOME=/gradle \
    -e SPRING_PROFILES_ACTIVE=ci \
    -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
    -w "$REPO_ROOT/server/business-api" \
    "$IMAGE" ./gradlew build --no-daemon --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
