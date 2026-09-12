#!/bin/bash
# CI와 동일한 검사를 로컬에서 실행 (dev-ci.yml → be-check-style · be-spot-bugs · be-test)
#
# ci 프로파일은 `jdbc:postgresql://localhost:5432/tt_db` (ci/ci) 를 가리킨다. CI 에서는
# GitHub Actions 의 services: postgres 가 그 자리에 있다. 로컬엔 없으므로 여기서 같은
# 좌표로 컨테이너를 띄우고 끝나면 치운다 — 이미 5432 에 쓸 수 있는 DB 가 있으면 그걸 쓴다.
#
# checkstyleTest 는 build.gradle 에서 꺼져 있어(`checkstyleTest.enabled = false`) CI 가
# 호출해도 no-op 이다. 그래서 여기서도 부르지 않는다.

set -e

cd "$(dirname "$0")"

# 고정 이름을 쓰면 «다른 체크아웃에서 같은 스크립트가 준비 중인» 컨테이너를 남의 것인 줄
# 모르고 지운다. 실행마다 고유 이름을 만들고, 이 프로세스가 띄운 것만 정리한다.
PG_CONTAINER="norm-postgres-$$-$(date +%s)"
STARTED_PG=0

db_ready() {
    docker run --rm --network host postgres:16-alpine \
        pg_isready -h localhost -p 5432 -U ci -d tt_db >/dev/null 2>&1
}

cleanup() {
    if [ "$STARTED_PG" = "1" ]; then
        docker stop "$PG_CONTAINER" >/dev/null 2>&1 || true
        docker rm "$PG_CONTAINER" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
    echo "Docker 가 떠 있지 않다 — 테스트가 DB 에 붙지 못한다." >&2
    exit 1
fi

if ! db_ready; then
    echo "localhost:5432 에 tt_db 가 없다 — 임시 컨테이너를 띄운다."
    docker run -d --name "$PG_CONTAINER" \
        -e POSTGRES_DB=tt_db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci \
        -p 5432:5432 postgres:16-alpine >/dev/null
    STARTED_PG=1
    echo -n "PostgreSQL 대기"
    for _ in $(seq 1 60); do
        if docker exec "$PG_CONTAINER" pg_isready -U ci -d tt_db >/dev/null 2>&1; then
            echo " — 준비 완료"
            break
        fi
        echo -n "."
        sleep 1
    done
fi

echo "=========================================="
echo " 1/3  Checkstyle"
echo "=========================================="
./gradlew checkstyleMain

echo ""
echo "=========================================="
echo " 2/3  SpotBugs"
echo "=========================================="
./gradlew spotbugsMain

echo ""
echo "=========================================="
echo " 3/3  Test"
echo "=========================================="
SPRING_PROFILES_ACTIVE=ci ./gradlew test --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
