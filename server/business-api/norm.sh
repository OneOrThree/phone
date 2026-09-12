#!/bin/bash
# CI와 동일한 검사를 로컬에서 실행 (business-ci.yml 의 build 잡)
#
# business-api 는 다른 서버와 달리 «컨테이너 안에서» 검사한다. PDF 미리보기 테스트가
# poppler-utils(pdftotext)·util-linux 에 의존하는데 그건 Dockerfile 의 `test` 스테이지가
# 깔아준다. 호스트에서 곧장 ./gradlew build 를 돌리면 그 도구가 없는 기기에서 조용히
# 다르게 동작한다 — 그래서 CI 와 같은 이미지를 쓴다.
#
# 컨테이너 안 테스트가 다시 Testcontainers 를 띄운다. 그 컨테이너들은 «도커 호스트»에 동적
# 포트로 게시되므로, 검사 컨테이너가 그 포트에 닿을 수 있어야 한다. 닿는 방법이 OS 마다 다르다
# — 아래 «OS 별 분기» 주석 참고. 한쪽 설정을 양쪽에 쓰면 반드시 한쪽이 깨진다.

set -e

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
# 고정 태그를 쓰면 «다른 체크아웃에서 같은 스크립트가 돌 때» 그쪽 cleanup 이 이 태그를
# 지워버려, 아직 docker run 에 닿지 못한 실행이 이미지를 잃는다(그리고 pull 을 시도하다
# 실패한다). CI 의 ${GITHUB_RUN_ID} 처럼 실행마다 고유 태그를 쓰고 그것만 정리한다.
IMAGE="business-api-test:norm-$$-$(date +%s)"
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

# ── OS 별 분기 ────────────────────────────────────────────────────────────────
# 네트워크와 실행 사용자, 둘 다 리눅스와 macOS 에서 답이 반대다. 실측으로 확인한 내용:
#
# 리눅스(= CI 러너): CI(business-ci.yml)와 똑같이 `--network host` + 127.0.0.1 이다.
#   기본 bridge 에는 host.docker.internal 이 없어서 그걸 쓰면 CI 와 같은 리눅스에서
#   여기만 연결이 실패한다. 그리고 test 스테이지엔 USER 지시가 없어 기본 사용자가 root 인데,
#   리눅스 bind mount 는 호스트 uid 를 그대로 쓰므로 build/ 산출물이 root 소유로 남아
#   이후 일반 사용자의 ./gradlew clean 이 권한 오류로 깨진다. 그래서 CI 처럼 호스트 uid 로
#   낮추고 docker 소켓 그룹을 더해 준다.
#
# macOS(Docker Desktop): 정반대로 `--network host` 를 쓰면 «깨진다». Desktop 은 게시된
#   포트를 맥 쪽 프록시로 전달할 뿐 리눅스 VM 의 loopback 에는 열지 않아서, VM 네트워크
#   네임스페이스에 들어간 컨테이너는 127.0.0.1:<포트> 에서 아무것도 못 본다
#   (Ryuk 연결 거부 → Testcontainers 쓰는 2개 클래스가 통째로 실패). 그래서 기본 bridge +
#   host.docker.internal 을 쓴다. 사용자도 낮추지 않는다 — Desktop 은 bind mount 소유자를
#   호스트 사용자로 되매핑해 주어 root 소유 문제가 없고, 반대로 --user 로 낮추면 VM 안
#   docker 소켓(root:root)에 닿지 못해 Testcontainers 가 죽는다.
DOCKER_OS_ARGS=()
if [ "$(uname -s)" = "Linux" ]; then
    TC_HOST=127.0.0.1
    DOCKER_OS_ARGS=(--network host --user "$(id -u):$(id -g)")
    if [ -S /var/run/docker.sock ]; then
        DOCKER_OS_ARGS+=(--group-add "$(stat -c '%g' /var/run/docker.sock)")
    fi
else
    TC_HOST=host.docker.internal
fi

docker run --rm \
    "${DOCKER_OS_ARGS[@]}" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$REPO_ROOT:$REPO_ROOT" \
    -v "$GRADLE_HOME:/gradle" \
    -e GRADLE_USER_HOME=/gradle \
    -e SPRING_PROFILES_ACTIVE=ci \
    -e TESTCONTAINERS_HOST_OVERRIDE="$TC_HOST" \
    -w "$REPO_ROOT/server/business-api" \
    "$IMAGE" ./gradlew build --no-daemon --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
