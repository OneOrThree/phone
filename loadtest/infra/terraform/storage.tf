# params: seed 산출물(Zipf 유저·토큰·검색어) — 부하 VM 이 run 시 pull
resource "google_storage_bucket" "params" {
  name                        = "${var.project_id}-params"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true # seed 재생성 가능 산출물
}

# reports: run 리포트 원본 보관 (slim 은 loadtest-reports 브랜치, 전체는 artifact + 여기)
resource "google_storage_bucket" "reports" {
  name                        = "${var.project_id}-reports"
  location                    = var.region
  uniform_bucket_level_access = true
  versioning {
    enabled = true
  }
}

# SUT 이미지 저장소 — back/Dockerfile 을 핀 SHA 로 빌드해 push (M5/M8)
resource "google_artifact_registry_repository" "images" {
  repository_id = "loadtest"
  location      = var.region
  format        = "DOCKER"
  description   = "SUT 이미지 (back/Dockerfile, 핀 SHA — prod 동일 Dockerfile)"
}
