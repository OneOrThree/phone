# 부하테스트 Prometheus 스크레이프 — make sync 가 envsubst 로 렌더해 관측 VM 에 배치.
# 변수: ${SUT_HOST}(SUT 내부 IP), ${LOADGEN_TARGETS}(loadgen-0..5 targets 줄 — sync.sh 가 6대 조립).
# dev(observability/prometheus/prometheus.yml)와 같은 5s 그레인 — 대시보드 호환.
global:
  scrape_interval: 5s
  scrape_timeout: 4s
  evaluation_interval: 5s

scrape_configs:
  # 서버 층 — Spring Boot micrometer (URI별 p95/p99·HikariCP·JVM)
  - job_name: gromo-back
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ['${SUT_HOST}:9091']

  # 시스템 층 — SUT 호스트
  - job_name: node
    static_configs:
      - targets: ['${SUT_HOST}:9100']

  # 부하기 가드 — 부하 VM CPU>80% 면 run 무효(INVALID). run 중이 아닐 땐 DOWN 이 정상.
  # GROMO-763: loadgen-0..N 다중 타겟 — sync.sh 가 ${LOADGEN_TARGETS} 를 6대(상한) targets 줄로 렌더.
  #            SPOTS<6 이면 미기동 VM 은 DOWN → collect 의 max by(instance) 에서 자연 제외.
  - job_name: loadgen
    static_configs:
${LOADGEN_TARGETS}
  # DB 층 — Cloud SQL (같은 compose 안 exporter)
  - job_name: postgres
    static_configs:
      - targets: ['postgres-exporter:9187']

  # Prometheus 자체 (+ k6 클라 층은 remote write 로 유입 — 스크레이프 없음)
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
