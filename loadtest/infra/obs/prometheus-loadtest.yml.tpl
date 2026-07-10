# 부하테스트 Prometheus 스크레이프 — make sync 가 envsubst 로 렌더해 관측 VM 에 배치.
# 변수: ${SUT_HOST}(SUT 내부 IP), ${LOADGEN_HOST}(부하 VM 내부 DNS — run 중이 아닐 땐 DOWN 이 정상)
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
  - job_name: loadgen
    static_configs:
      - targets: ['${LOADGEN_HOST}:9100']

  # DB 층 — Cloud SQL (같은 compose 안 exporter)
  - job_name: postgres
    static_configs:
      - targets: ['postgres-exporter:9187']

  # Prometheus 자체 (+ k6 클라 층은 remote write 로 유입 — 스크레이프 없음)
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
