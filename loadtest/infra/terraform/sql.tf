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
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.db_disk_size_gb
    disk_autoresize   = false # 예산 가드 — 시드가 예상보다 크면 명시적으로 늘린다

    ip_configuration {
      ipv4_enabled    = false # 사설 IP 전용
      private_network = google_compute_network.loadtest.id
    }

    # 쿼리 관측 4계층의 ①②용 플래그 (부하테스트-아키텍처 §4-1)
    database_flags {
      name  = "shared_preload_libraries"
      value = "pg_stat_statements,auto_explain"
    }
    database_flags {
      name  = "pg_stat_statements.track"
      value = "top"
    }
    database_flags {
      name  = "auto_explain.log_min_duration"
      value = "100"
    }
    database_flags {
      name  = "auto_explain.log_analyze"
      value = "on"
    }
    database_flags {
      name  = "auto_explain.log_buffers"
      value = "on"
    }
    database_flags {
      name  = "auto_explain.log_format"
      value = "json"
    }

    insights_config {
      query_insights_enabled = true # 무료 보너스 — pg_stat_statements 보완 대시보드
    }

    backup_configuration {
      enabled = false # 측정용 일회성 데이터 — golden 이 곧 백업
    }
  }

  deletion_protection = true # 실수로 golden(수십 분짜리 시드)을 날리지 않게

  depends_on = [google_service_networking_connection.psa]
}

resource "google_sql_user" "app" {
  name     = "loadtest"
  instance = google_sql_database_instance.loadtest.name
  password = random_password.db_password.result
}
