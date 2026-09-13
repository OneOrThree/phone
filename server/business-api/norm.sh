#!/bin/bash
# CI와 동일한 검사를 로컬에서 실행 (satellite-ci.yml 의 build 잡, matrix service=business-api)
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

# 안쪽 테스트가 다시 Testcontainers 를 띄우려면 도커 소켓을 물려줘야 하는데, 그 소켓이
# 늘 /var/run/docker.sock 인 것은 아니다. rootless 도커는 /run/user/<uid>/docker.sock 이고
# 활성 컨텍스트가 다른 경로를 가리킬 수도 있다(이 맥의 desktop-linux 가 그렇다 —
# /var/run/docker.sock 이 ~/.docker/run/docker.sock 으로 걸린 심볼릭 링크다).
# 그런 기기에서 경로를 박아 두면 docker info 는 멀쩡히 통과하고 마운트 단계에서 죽거나,
# 붙긴 해도 안쪽 Testcontainers 가 데몬을 못 찾는다. 활성 endpoint 에서 실제 소켓을 찾는다.
DOCKER_SOCK=""
case "${DOCKER_HOST:-}" in
    unix://*) DOCKER_SOCK="${DOCKER_HOST#unix://}" ;;
esac
if [ -z "$DOCKER_SOCK" ]; then
    ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
    case "$ENDPOINT" in
        unix://*) DOCKER_SOCK="${ENDPOINT#unix://}" ;;
    esac
fi
[ -z "$DOCKER_SOCK" ] && DOCKER_SOCK=/var/run/docker.sock
if [ ! -S "$DOCKER_SOCK" ]; then
    echo "도커 소켓을 찾지 못했다: $DOCKER_SOCK" >&2
    echo "DOCKER_HOST 가 unix 소켓이 아니면(TCP 등) 이 스크립트는 쓸 수 없다." >&2
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

# clean 을 붙인다. build/ 는 저장소에서 bind mount 되므로 앞선 실행의 결과가 그대로 남아,
# 소스가 그대로면 test 가 UP-TO-DATE 로 건너뛰어진다. 소스가 아니라 «환경»(도커 이미지·
# Testcontainers 네트워크)이 바뀌거나 고장 난 경우에도 Gradle 의 입력 해시는 그대로라,
# 깨끗한 체크아웃에서 실제로 도는 CI 는 실패하는데 로컬 게이트만 초록이 된다.
# (이 PR 에서 실제로 두 번 당했다 — 5초 만에 전 태스크 UP-TO-DATE 로 「모든 검사 통과」.)
# build 는 라이프사이클 태스크라 --rerun 을 붙일 수 없어 CI 와 같은 깨끗한 상태를 만든다.
# 의존성 캐시는 GRADLE_HOME 에 따로 있어 clean 이 건드리지 않는다.

# ── OS 별 분기 ────────────────────────────────────────────────────────────────
# 네트워크와 실행 사용자, 둘 다 리눅스와 macOS 에서 답이 반대다. 실측으로 확인한 내용:
#
# 리눅스(= CI 러너): CI(satellite-ci.yml)와 똑같이 `--network host` + 127.0.0.1 이다.
#   기본 bridge 에는 host.docker.internal 이 없어서 그걸 쓰면 CI 와 같은 리눅스에서
#   여기만 연결이 실패한다. 그리고 test 스테이지엔 USER 지시가 없어 기본 사용자가 root 인데,
#   리눅스 bind mount 는 호스트 uid 를 그대로 쓰므로 build/ 산출물이 root 소유로 남아
#   이후 일반 사용자의 ./gradlew clean 이 권한 오류로 깨진다. 그래서 CI 처럼 호스트 uid 로
#   낮추고 docker 소켓 그룹을 더해 준다.
#
# macOS(Docker Desktop): 정반대로 `--network host` 를 쓰면 «깨진다». Desktop 에서 «동적으로
#   배정된» 게시 포트는 VM 네트워크 네임스페이스에서 보이지 않는다. 프로브로 확인한 경계:
#   포트를 명시해 게시하면(-p 5598:80 / -p 127.0.0.1:5599:80) 호스트네트워크 컨테이너에서
#   보이지만, 동적 배정이면(-p ::80 / -p 127.0.0.1::80) 바인딩 주소와 무관하게 안 보인다.
#   Testcontainers 는 Ryuk 을 포함해 전부 동적 포트로 띄우므로 여기에 정통으로 걸린다
#   (Ryuk 연결 거부 → Testcontainers 쓰는 2개 클래스가 통째로 실패). bridge 에서는 네 경우
#   모두 host.docker.internal 로 닿는다. 그래서 macOS 는 기본 bridge + host.docker.internal.
#   사용자도 낮추지 않는다 — Desktop 은 bind mount 소유자를 호스트 사용자로 되매핑해 주어
#   root 소유 문제가 없고, 반대로 --user 로 낮추면 VM 안 docker 소켓(root:root)에 닿지 못해
#   Testcontainers 가 죽는다.
DOCKER_OS_ARGS=()
if [ "$(uname -s)" = "Linux" ]; then
    TC_HOST=127.0.0.1
    DOCKER_OS_ARGS=(--network host --user "$(id -u):$(id -g)")
    DOCKER_OS_ARGS+=(--group-add "$(stat -c '%g' "$DOCKER_SOCK")")
    # 소켓이 표준 경로가 아니면(rootless 등) 데몬도 그 경로에 있다. Testcontainers 가
    # Ryuk 에 마운트할 «호스트» 경로를 그걸로 알려 줘야 한다. macOS(Docker Desktop)에서는
    # 데몬이 VM 안에 있어 그쪽 경로는 /var/run/docker.sock 이므로 건드리지 않는다.
    if [ "$DOCKER_SOCK" != "/var/run/docker.sock" ]; then
        DOCKER_OS_ARGS+=(-e "TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=$DOCKER_SOCK")
    fi
else
    TC_HOST=host.docker.internal
fi

docker run --rm \
    "${DOCKER_OS_ARGS[@]}" \
    -v "$DOCKER_SOCK:/var/run/docker.sock" \
    -e DOCKER_HOST=unix:///var/run/docker.sock \
    -v "$REPO_ROOT:$REPO_ROOT" \
    -v "$GRADLE_HOME:/gradle" \
    -e GRADLE_USER_HOME=/gradle \
    -e SPRING_PROFILES_ACTIVE=ci \
    -e TESTCONTAINERS_HOST_OVERRIDE="$TC_HOST" \
    -w "$REPO_ROOT/server/business-api" \
    "$IMAGE" ./gradlew clean build --no-daemon --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
