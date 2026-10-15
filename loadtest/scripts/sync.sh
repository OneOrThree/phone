#!/usr/bin/env bash
# make sync — 레포(진실 원천)의 관측·기동 설정을 VM 에 반영.
#   obs: compose·grafana provisioning·대시보드(repo 재사용+loadtest)·렌더된 prometheus.yml·vm_env.sh
#   sut: compose·fetch-env.sh
. "$(dirname "$0")/common.sh"
LT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

SUT_IP=$(ip_of sut)
# 부하 VM 은 run 마다 재생성 — 존별 내부 DNS 는 이름 기준이라 재생성에도 안정.
# GROMO-763: loadgen-0..5 6대(상한)를 항상 등록 — sync 시점 SPOTS 와 run 시점 SPOTS 불일치로 인한
# 결측 스크레이프(가장 조용한 실패)를 원천 차단. SPOTS<6 이면 미기동 VM 은 DOWN(정상), CPU 가드
# max by(instance) 에서 자연 제외되므로 무해. 들여쓰기 6칸(YAML) + 각 줄 개행 유지.
DNS_SUF="${ZONE}.c.${PROJECT_ID}.internal"
LOADGEN_TARGETS=""
for i in $(seq 0 5); do
  LOADGEN_TARGETS+="      - targets: ['loadgen-${i}.${DNS_SUF}:9100']"$'\n'
done

log "obs 설정 반영 (SUT=${SUT_IP}, LOADGEN loadgen-0..5)"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT # promtool 게이트 exit 1 등 어떤 경로로 죽어도 임시파일 잔존 방지 (#215 리뷰)
SUT_HOST="$SUT_IP" LOADGEN_TARGETS="$LOADGEN_TARGETS" \
  envsubst '$SUT_HOST $LOADGEN_TARGETS' < "$LT_DIR/infra/obs/prometheus-loadtest.yml.tpl" > "$TMP"

# 렌더 결과 검증(fail-fast) — envsubst 는 주석까지 치환해 조용히 YAML 을 부술 수 있다(gha-8·9:
# 깨진 설정이 그대로 배포 → prometheus crash-loop → 25분 run 뒤 INVALID 로 간접 발견).
# obs 와 동일 이미지의 promtool 로 스키마까지 검사해 그 실패 클래스를 sync 단계 즉사로 바꾼다.
chmod 644 "$TMP" # mktemp 0600 → 컨테이너 기본 유저(nobody)가 읽도록
# pull 을 분리 — 인프라 실패(네트워크·레지스트리)와 렌더 깨짐을 다른 메시지로 보고 (#215 리뷰)
docker image inspect prom/prometheus:v2.55.1 >/dev/null 2>&1 \
  || docker pull -q prom/prometheus:v2.55.1 >/dev/null \
  || { log "❌ prom/prometheus 이미지 pull 실패 — 네트워크/레지스트리 확인 (렌더 문제 아님)"; exit 1; }
docker run --rm -v "$TMP:/prometheus.yml:ro" --entrypoint promtool \
  prom/prometheus:v2.55.1 check config /prometheus.yml \
  || { log "❌ prometheus.yml 렌더 결과 깨짐(promtool) — 배포 중단"; exit 1; } # 태그는 docker-compose.obs.yml 과 동일 유지

vm_ssh obs 'mkdir -p ~/obs/dashboards/repo ~/obs/dashboards/loadtest ~/seed'
vm_scp "$TMP" obs:~/obs/prometheus.yml
vm_scp "$LT_DIR/infra/obs/docker-compose.obs.yml" "$LT_DIR/infra/obs/grafana-provisioning" \
  "$LT_DIR/infra/fetch-env.sh" obs:~/obs/
vm_scp "$LT_DIR"/../server/observability/grafana/dashboards/*.json obs:~/obs/dashboards/repo/
vm_scp "$LT_DIR"/grafana/dashboards/*.json obs:~/obs/dashboards/loadtest/
# 컨테이너(prometheus=nobody, grafana=비root)가 마운트한 config 를 읽으려면 other-read 필요.
# prometheus.yml(mktemp 0600 유래) + provisioning/dashboards(체크아웃 umask 에 좌우, umask 077 대비)
# 를 한 번에 확정 개방 — 같은 "컨테이너 non-root 가독" 실패 클래스를 통째로 닫는다.
vm_ssh obs 'chmod 644 ~/obs/prometheus.yml && chmod -R a+rX ~/obs/grafana-provisioning ~/obs/dashboards'
# reset·검증·pg_stat 덤프가 seed 실행 여부와 무관하게 항상 가능하도록 운영 SQL 을 배치하고,
# 그 SQL 을 실행할 psql 바이너리도 함께 보장한다 — psql 설치는 seed.sh(make seed) 에만 있고
# obs startup 은 Docker 만 깐다. 존 이동으로 obs 가 새 디스크로 재생성되면 SQL 은 sync 로 올라오지만
# psql 이 없어 reset.sh 의 obs_psql 이 exit 127(command not found)로 죽는다(gha-16 실증). 멱등: 있으면 스킵.
vm_scp "$LT_DIR/seed/vm_env.sh" "$LT_DIR/seed/reset.sql" "$LT_DIR/seed/95_verify.sql" obs:~/seed/
vm_ssh obs 'command -v psql >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client)'

log "sut 설정 반영"
vm_ssh sut 'mkdir -p ~/sut'
vm_scp "$LT_DIR/infra/sut/docker-compose.sut.yml" "$LT_DIR/infra/fetch-env.sh" sut:~/sut/

log "완료 — 반영은 make up (compose up -d) 이 적용"
