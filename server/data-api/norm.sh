#!/bin/bash
# CI 와 같은 검사를 같은 순서로 로컬에서 돌린다.
# (data-api-ci.dev.yml 이 be-gradle.yml 을 세 번 부른다: checkstyleMain checkstyleTest · spotbugsMain · test bootJar)
#
# 호스트 DB 를 띄우지 않는다. 테스트는 전부 Testcontainers 가 자기 PostgreSQL 을 띄운다 —
# GROMO-1793 이 데이터소스를 죽은 포트에 두고 전체 스위트가 통과함을 확인했고, be-gradle.yml 도
# DB 없이 돈다(단, CI 는 데이터소스 값을 따로 두지 않는다). 여기서는 한 발 더 나가 데이터소스를
# 일부러 죽은 포트로 고정한다 — 어떤 테스트가 호스트 DB 에 기대기 시작하면 CI 보다 먼저 여기서 드러난다.
#
# checkstyleTest · spotbugsTest 는 build.gradle 에서 꺼져 있어 no-op 이지만 CI 와 같은 태스크 목록을
# 부른다 — 켜지는 날 로컬 게이트도 같이 켜지게.
#
# --rerun: 로컬은 build/ 가 남아 있어 소스가 그대로면 Gradle 이 UP-TO-DATE 로 건너뛴다. 도커·
# Testcontainers 환경이 깨져도 입력 해시는 같아 아무 검사도 안 돌고 게이트가 초록이 된다(실제로 두 번
# 당했다). 컴파일은 증분으로 두고 검사 태스크만 강제한다.
#
# 사용:
#   ./norm.sh                                       전부 — CI 와 동일
#   ./norm.sh --tests '*FooTest' --tests '*Bar*'    test 태스크에만 필터를 넘긴다(Checkstyle·SpotBugs 는 그대로)
#
# 실패하면 그 자리에서 Gradle 의 종료 코드로 멈춘다 — 뒤 단계는 돌지 않는다.
#
# 검증: .github/scripts/test_data_api_norm.py (Agent Harness 워크플로가 PR 마다 돌린다).
#   - 태스크·인자·순서·출력 문구를 바꾸면 그 테스트의 기대 호출 목록(test_full_gate_… 의 리스트)도 같이 고친다.
#   - 그 테스트는 이 스크립트의 «호출»만 고정한다. be-gradle.yml 의 태스크가 바뀌어도 초록이다 —
#     CI 와의 일치는 사람이 대조한다(data-api-ci.dev.yml 의 세 tasks).
#   - 테스트는 ubuntu bash 5 로 돈다. macOS bash 3.2 호환(set -u 를 쓰지 않는 이유)은 CI 가 보지 않는다.

cd "$(dirname "$0")" || exit 1

if ! docker info >/dev/null 2>&1; then
    echo "Docker 가 떠 있지 않다 — Testcontainers 가 PostgreSQL 을 띄우지 못한다." >&2
    exit 1
fi

export SPRING_PROFILES_ACTIVE=ci
# 죽은 포트. 어떤 테스트가 여기에 붙으려 하면 그 테스트가 호스트 DB 에 기대고 있다는 뜻이다.
export SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:1/norm-no-host-db"

run() {
    local title="$1"
    shift
    echo ""
    echo "=========================================="
    echo " $title"
    echo "=========================================="
    ./gradlew "$@"
    local status=$?
    if [ "$status" -ne 0 ]; then
        echo "!! $title 실패 (종료 코드 $status) — 뒤 단계는 돌지 않는다." >&2
        exit "$status"
    fi
}

run "1/3  Checkstyle" checkstyleMain --rerun checkstyleTest --rerun
run "2/3  SpotBugs" spotbugsMain --rerun
run "3/3  Test + bootJar" test --rerun "$@" bootJar --stacktrace

echo ""
echo "=========================================="
if [ "$#" -gt 0 ]; then
    echo " 지정한 테스트만 돌았다: $*"
    echo " (전체 게이트가 아니다 — 푸시 전엔 인자 없이 다시 돌린다)"
else
    echo " 모든 검사 통과"
fi
echo "=========================================="
