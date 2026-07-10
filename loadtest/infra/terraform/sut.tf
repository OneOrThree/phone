# SUT VM — Spring Boot(loadtest 프로파일) 이 docker compose 로 뜨는 측정 대상.
# compose 정의·기동은 make up(M5) 소관 — terraform 은 머신·디스크·네트워크까지만.
resource "google_compute_instance" "sut" {
  name             = "sut"
  machine_type     = var.sut_machine_type
  min_cpu_platform = var.sut_min_cpu_platform # run 간 CPU 세대 고정 — baseline ±10% 판정 전제
  zone             = var.zone
  tags             = ["sut"]

  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = local.vm_image
      size  = 20
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id
    access_config {} # ephemeral 공개 IP — 이미지 pull 용 egress 전용 (인바운드는 방화벽 차단)
  }

  service_account {
    email  = local.sa_email
    scopes = ["cloud-platform"] # 권한은 IAM 역할로 제어
  }

  metadata_startup_script = file("${path.module}/scripts/install-docker.sh")

  # make up/down 이 gcloud start/stop 으로 제어 — terraform 은 존재만 관리
  desired_status = "RUNNING"
  lifecycle {
    ignore_changes = [desired_status]
  }
}
