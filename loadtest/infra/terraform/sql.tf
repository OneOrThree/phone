# Cloud SQL PostgreSQL 16 — SUT 의 DB. golden/loadtest/analysis 3개 DB 를 담는다.
# DB 생성 자체는 terraform 이 아니라 seed 파이프라인이 수행 (loadtest/analysis 는
# `CREATE DATABASE … TEMPLATE golden` 복제라 상태 관리 대상이 아님).
resource "google_sql_database_instance" "loadtest" {
  name             = "loadtest-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  # 유휴 시 make down 이 gcloud 로 activation-policy=NEVER 전환 — terraform 과 싸우지 않게 무시
  lifecycle {
    ignore_changes = [settings[0].activation_policy]
  }

  settings {
    tier = var.db_tier
    # 신규 프로젝트는 기본 Edition 이 ENTERPRISE_PLUS 로 잡혀 db-custom-* tier 를 거부한다.
    # 커스텀 tier(db-custom-2-8192)는 ENTERPRISE Edition 에서만 허용 — 명시.
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.db_disk_size_gb
    disk_autoresize   = false # 예산 가드 — 시드가 예상보다 크면 명시적으로 늘린다

    ip_configuration {
      ipv4_enabled    = false # 사설 IP 전용
      private_network = google_compute_network.loadtest.id
      # 명시 결정(#177 리뷰): 전용 VPC 사설 IP 가 경계 — 클라이언트(psql·JDBC·exporter) SSL 설정
      # 마찰을 피하기 위해 평문 허용. 외부 노출 경로 자체가 없다.
      ssl_mode = "ALLOW_UNENCRYPTED_AND_ENCRYPTED"
    }

    # 쿼리 관측 (부하테스트-아키텍처 §4) — Cloud SQL 특성 반영, database_flags 불필요:
    #  ① pg_stat_statements: Cloud SQL 은 기본 preload 하므로 shared_preload_libraries 설정 불필요.
    #     seed 의 CREATE EXTENSION pg_stat_statements 로 활성화 → pg_top20 델타 덤프 그대로 동작.
    #  ② auto_explain: Cloud SQL 은 사용자 flag 로 노출하지 않음 → insights_config(Query Insights)로 대체.
    # (신규 프로젝트에서 shared_preload_libraries·auto_explain·pg_stat_statements.track 이 전부
    #  invalidFlagName 으로 거부돼 실측으로 교정 — Cloud SQL 은 이 계층을 관리형으로 제공한다.)

    insights_config {
      query_insights_enabled = true # 쿼리별 지연·샘플 플랜 (auto_explain 대체) — 무료
    }

    backup_configuration {
      enabled = false # 측정용 일회성 데이터 — golden 이 곧 백업
    }
  }

  # 실수로 golden(수십 분짜리 시드)을 날리지 않게. 의도적 destroy/replace 시에는
  # 먼저 false 로 한 번 apply 해야 한다 (#177 리뷰 운영 노트).
  deletion_protection = true

  depends_on = [google_service_networking_connection.psa]
}

resource "google_sql_user" "app" {
  name     = "loadtest"
  instance = google_sql_database_instance.loadtest.name
  password = random_password.db_password.result
}
