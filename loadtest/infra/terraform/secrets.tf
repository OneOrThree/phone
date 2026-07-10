# 시크릿 — 전용 랜덤 생성 (AWS dev 시크릿 복사 금지 원칙, PRD §7-3)
# SUT·mint 도구가 같은 JWT 시크릿을 읽어 토큰 서명·검증이 일치한다.

resource "random_password" "jwt_secret" {
  length  = 64
  special = false # HS256 키 — base64 유사 문자만으로 충분, 셸 인용 사고 방지
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "jwt" {
  secret_id = "loadtest-jwt-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "jwt" {
  secret      = google_secret_manager_secret.jwt.id
  secret_data = random_password.jwt_secret.result
}

resource "google_secret_manager_secret" "db" {
  secret_id = "loadtest-db-password"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db" {
  secret      = google_secret_manager_secret.db.id
  secret_data = random_password.db_password.result
}
