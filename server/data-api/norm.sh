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

# 호스트의 5432 를 «컨테이너에서» 들여다보는 방법이 OS 마다 다르다.
#   리눅스: --network host + localhost. 기본 bridge 에는 host.docker.internal 이 없다.
#   macOS(Docker Desktop): 기본 bridge + host.docker.internal.
#     --network host 는 Desktop 4.34 부터 «설정에서 따로 켜야» 동작한다. 꺼져 있는 기기에서는
#     컨테이너의 localhost 가 맥 호스트가 아니라 제 자신을 가리켜, 5432 에 DB 가 멀쩡히 떠
#     있어도 「없다」고 판정한다. 그러면 아래에서 이미 쓰이는 5432 에 다시 바인딩하려다
#     아무 검사도 못 돌고 죽는다. host.docker.internal 은 켜짐/꺼짐과 무관하게 동작하고,
#     맥 loopback 에만 바인딩한 DB(-p 127.0.0.1:5432:5432·네이티브 설치)도 볼 수 있다.
if [ "$(uname -s)" = "Linux" ]; then
    PG_PROBE_ARGS=(--network host)
    PG_PROBE_HOST=localhost
else
    PG_PROBE_ARGS=()
    PG_PROBE_HOST=host.docker.internal
fi

# pg_isready 로는 모자란다 — 그건 «서버가 응답하는가» 만 보고 인증도 DB 존재도 확인하지
# 않는다. 5432 에 다른 용도의 Postgres 가 떠 있으면(예: 로컬 개발용 DB) 「준비됨」이라
# 답해 버리고, 그러면 컨테이너를 안 띄운 채 테스트가 인증 실패로 무더기로 깨진다.
# ci 프로파일이 실제로 하는 것과 같은 접속(tt_db, ci/ci)을 해 봐야 답이 맞다.
db_ready() {
    docker run --rm -e PGPASSWORD=ci "${PG_PROBE_ARGS[@]}" postgres:16-alpine \
        psql -h "$PG_PROBE_HOST" -p 5432 -U ci -d tt_db -Atc 'select 1' >/dev/null 2>&1
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
    # 이름을 «넘기는 순간» 부터 정리 대상이다. docker run 이 실패해도 컨테이너가
    # created 상태로 남는 경우가 있어(포트 바인딩 실패가 그렇다), 성공한 뒤에 세우면 샌다.
    # 이름은 이 프로세스 고유라 이렇게 해도 남의 컨테이너엔 닿지 않는다.
    STARTED_PG=1
    docker run -d --name "$PG_CONTAINER" \
        -e POSTGRES_DB=tt_db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci \
        -p 5432:5432 postgres:16-alpine >/dev/null || {
        echo "5432 바인딩 실패 — 그 포트를 쓰는 무언가가 이미 있는데 tt_db(ci/ci) 로는 붙지 못했다." >&2
        echo "쓰고 있는 것을 내리거나, tt_db·ci/ci 로 맞춘 DB 를 5432 에 올려 두고 다시 실행하라." >&2
        exit 1
    }
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

# 세 태스크 모두 --rerun 으로 부른다. CI 는 깨끗한 체크아웃에서 도니 언제나 실제로 돌지만,
# 로컬은 build/ 가 남아 있어 «소스가 그대로면» Gradle 이 UP-TO-DATE 로 건너뛴다. 문제는
# 소스 말고 «환경» 이 바뀐 경우다 — 도커 이미지·Testcontainers 네트워크 설정이 바뀌거나
# 고장 나도 Gradle 의 입력 해시는 그대로라, 아무 검사도 안 돌고 게이트가 초록이 된다.
# (이 PR 에서 실제로 두 번 당했다. 5초 만에 전 태스크 UP-TO-DATE 로 「모든 검사 통과」가 떴다.)
# 컴파일은 증분으로 두고 검사 태스크만 강제한다.
echo "=========================================="
echo " 1/3  Checkstyle"
echo "=========================================="
./gradlew checkstyleMain --rerun

echo ""
echo "=========================================="
echo " 2/3  SpotBugs"
echo "=========================================="
./gradlew spotbugsMain --rerun

echo ""
echo "=========================================="
echo " 3/3  Test"
echo "=========================================="
SPRING_PROFILES_ACTIVE=ci ./gradlew test --rerun --stacktrace

echo ""
echo "=========================================="
echo " 모든 검사 통과"
echo "=========================================="
