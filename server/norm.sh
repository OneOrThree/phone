#!/bin/bash
# 이 체크아웃에 있는 «모든» 서버의 로컬 CI 게이트를 순서대로 돌린다.
#
# 서버마다 검사 방식이 다르다(data-api 는 태스크를 나눠 부르고, realtime·notification 은
# `./gradlew build` 한 번, business-api 는 컨테이너 안에서 돈다). 그래서 여기서 명령을
# 다시 쓰지 않고 각 서버의 norm.sh 에 위임한다 — CI 와의 대조는 그쪽 파일에 적혀 있다.
#
# 브랜치마다 있는 서버가 다르므로(예: server/notification 은 알림 분리 브랜치에만 있다)
# norm.sh 가 실제로 있는 디렉터리만 돈다.
#
# 사용:
#   server/norm.sh              전부
#   server/norm.sh data-api     지정한 것만

set -u

cd "$(dirname "$0")"

if [ "$#" -gt 0 ]; then
    TARGETS=("$@")
    EXPLICIT=1
else
    EXPLICIT=0
    TARGETS=()
    for d in */; do
        [ -x "${d}norm.sh" ] && TARGETS+=("${d%/}")
    done
fi

if [ "${#TARGETS[@]}" -eq 0 ]; then
    echo "norm.sh 를 가진 서버가 없다." >&2
    exit 1
fi

declare -a PASSED=() FAILED=()

for s in "${TARGETS[@]}"; do
    if [ ! -x "$s/norm.sh" ]; then
        if [ "$EXPLICIT" = "1" ]; then
            # 이름을 «찍어서» 부른 대상이 없으면 실패다. 건너뛰고 «전부 통과» 를 찍으면
            # 오타 하나로 아무 검사도 안 돈 채 게이트가 초록이 된다.
            echo "!! $s : norm.sh 없음 또는 실행 권한 없음 (지정한 대상이라 실패로 본다)"
            FAILED+=("$s")
        else
            echo "건너뜀: $s (norm.sh 없음 또는 실행 권한 없음)"
        fi
        continue
    fi
    echo ""
    echo "##########################################"
    echo "#  $s"
    echo "##########################################"
    if "./$s/norm.sh"; then
        PASSED+=("$s")
    else
        FAILED+=("$s")
        echo "!! $s 실패 — 계속 진행한다(끝에 모아서 보고)."
    fi
done

echo ""
echo "=========================================="
echo " 요약"
echo "=========================================="
[ "${#PASSED[@]}" -gt 0 ] && echo "  통과: ${PASSED[*]}"
if [ "${#FAILED[@]}" -gt 0 ]; then
    echo "  실패: ${FAILED[*]}"
    exit 1
fi
echo "  전부 통과"
