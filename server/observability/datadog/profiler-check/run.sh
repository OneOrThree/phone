#!/usr/bin/env bash
# GROMO-2574 — dd-java-agent 프로파일러 오류를 로컬 Docker 로 재현하고 기대값과 비교한다.
# 외부 연결 없음: 모든 컨테이너를 --network none 으로 띄운다(에이전트 전송 실패 줄은 그래서 항상 나온다).
# 내려받는 것은 이미지 빌드 때의 공개 베이스 이미지와 Maven Central 의 dd-java-agent 뿐이다.
#
#   bash server/observability/datadog/profiler-check/run.sh              # 호스트 아키텍처
#   PLATFORM=linux/amd64 bash server/observability/datadog/profiler-check/run.sh   # dev VM 과 같은 amd64
#
# 결과 원문은 OUT(기본 mktemp) 에 남고, 기대와 다르면 종료 코드 1.
set -eo pipefail   # -u 는 쓰지 않는다: macOS 기본 bash 3.2 에서 빈 배열 "${PLAT[@]}" 이 unbound 로 죽는다
HERE=$(cd "$(dirname "$0")" && pwd)
PLATFORM=${PLATFORM:-}
IMG=obs2562-2574-profcheck:${PLATFORM:+${PLATFORM##*/}-}local
WAIT=${WAIT:-40}   # 프로파일러 시작 지연(기본 10초)과 첫 로드 시도를 넘길 만큼
OUT=${OUT:-$(mktemp -d)}
mkdir -p "$OUT"
PLAT=(${PLATFORM:+--platform "$PLATFORM"})

docker build -q "${PLAT[@]}" -t "$IMG" "$HERE" >/dev/null

DD=(-e DD_PROFILING_ENABLED=true -e DD_AGENT_HOST=datadog-agent -e DD_SERVICE=profcheck -e DD_ENV=local)
TMP=/tmp:size=64m,mode=1777            # docker-compose.satellites.yml business-api 의 /tmp 와 같은 값
BIZ=(--read-only --user 10001:10001)    # business-api 의 read_only·비루트

run_case() {  # 이름, docker run 추가 인자...
  local name=$1; shift
  docker rm -f "obs2562-2574-$name" >/dev/null 2>&1 || true
  docker run "${PLAT[@]}" --name "obs2562-2574-$name" --network none "${DD[@]}" "$@" "$IMG" "$WAIT" \
    >"$OUT/$name.log" 2>&1 && echo 0 >"$OUT/$name.rc" || echo $? >"$OUT/$name.rc"
  docker rm -f "obs2562-2574-$name" >/dev/null 2>&1 || true
}

# A: 현재 business-api — /tmp tmpfs(exec 미지정 → Docker 기본 noexec)
run_case A-business "${BIZ[@]}" --tmpfs "$TMP" &
# B: A 의 /tmp 에 exec 만 추가
run_case B-tmp-exec "${BIZ[@]}" --tmpfs "$TMP,exec" &
# C: 현재 notification·realtime — tmpfs·read_only 없음, root
run_case C-plain &
# E: A 에서 네이티브 프로파일러만 끔 — 다른 경로(OTel 문맥·crash tracking)가 같은 .so 를 여전히 올리는지
run_case E-ddprof-off "${BIZ[@]}" --tmpfs "$TMP" -e DD_PROFILING_DDPROF_ENABLED=false &
# F: /tmp 는 noexec 유지, 프로파일러 임시 경로만 exec tmpfs(/ddprof) — compose 수정안과 같은 값
run_case F-tempdir "${BIZ[@]}" --tmpfs "$TMP" --tmpfs /ddprof:size=64m,mode=1777,exec -e DD_PROFILING_TEMPDIR=/ddprof &
wait

# D: realtime·data-api 재기동 재현 — 같은 컨테이너(쓰기 레이어 유지)를 한 번 더 시작
docker rm -f obs2562-2574-D-restart >/dev/null 2>&1 || true
docker run -d "${PLAT[@]}" --name obs2562-2574-D-restart --network none "${DD[@]}" "$IMG" 20 >/dev/null
docker wait obs2562-2574-D-restart >"$OUT/D-first.rc"
docker logs obs2562-2574-D-restart >"$OUT/D-first.log" 2>&1
docker start obs2562-2574-D-restart >/dev/null
docker wait obs2562-2574-D-restart >"$OUT/D-both.rc"
docker logs obs2562-2574-D-restart >"$OUT/D-both.log" 2>&1
docker rm -f obs2562-2574-D-restart >/dev/null

n() { grep -c -e "$2" "$OUT/$1.log" || true; }
fail=0
expect() {  # 이름, 패턴, 기대 건수
  local got; got=$(n "$1" "$2")
  if [ "$got" = "$3" ]; then echo "PASS $1 '$2' = $got"; else echo "FAIL $1 '$2' = $got (기대 $3)"; fail=1; fi
}
# 판정 규칙: 종료 코드 0(Idle 정상 종료) AND 양성 신호(에이전트 기동 줄 T) 1건 이상 AND 오류 패턴이 기대 건수.
# 컨테이너가 못 뜨거나 JVM 이 일찍 죽으면 오류 0건이어도 FAIL. 프로파일러가 도는 케이스는 프로파일러 모듈 기동 줄 L 도 필요하다.
rc_ok() {  # 이름
  local rc; rc=$(cat "$OUT/$1.rc" 2>/dev/null || echo 없음)
  if [ "$rc" = 0 ]; then echo "PASS $1 종료코드 = 0"; else echo "FAIL $1 종료코드 = $rc (기대 0)"; fail=1; fi
}
pos() {  # 이름, 패턴
  local got; got=$(n "$1" "$2")
  if [ "$got" -ge 1 ]; then echo "PASS $1 양성 '$2' = $got"; else echo "FAIL $1 양성 '$2' = $got (기대 1 이상)"; fail=1; fi
}
T='DATADOG TRACER CONFIGURATION'
L='ProcessContext - Registering process context for OTel profiler'
M='failed to map segment from shared object'
P='Failed to instantiate Datadog profiler'
N='getStringFlag(String)" is null'
U='Untrusted '
for c in A-business B-tmp-exec C-plain E-ddprof-off F-tempdir; do
  echo "$c $(grep -m1 '^MOUNT /tmp' "$OUT/$c.log" || echo 'MOUNT /tmp (없음)')"
done
expect A-business "$M" 2;  expect A-business "$P" 1;  expect A-business "$N" 2
expect B-tmp-exec "$M" 0;  expect B-tmp-exec "$P" 0;  expect B-tmp-exec "$N" 0
expect C-plain "$M" 0;     expect C-plain "$P" 0;     expect C-plain "$N" 0
expect E-ddprof-off "$M" 2; expect E-ddprof-off "$N" 2
expect F-tempdir "$M" 0;   expect F-tempdir "$P" 0;   expect F-tempdir "$N" 0
for c in A-business B-tmp-exec C-plain E-ddprof-off F-tempdir D-first D-both; do rc_ok $c; pos $c "$T"; done
for c in B-tmp-exec C-plain F-tempdir; do pos $c "$L"; done
expect D-first "$U" 0;     expect D-both "$U" 2
echo "원문: $OUT"
exit $fail
