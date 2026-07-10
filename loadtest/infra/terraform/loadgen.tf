# 부하 VM — 인스턴스 템플릿만 terraform 관리. VM 자체는 run 마다 scripts/loadgen.sh 가
# 생성·삭제한다(run 마다 빠른 create/delete 가 tf apply 보다 적합). 고정 이름 `loadgen` 으로
# 생성해 내부 DNS(loadgen.*.c.<project>.internal)가 재생성에도 안정 — Prometheus 타겟 유지.
resource "google_compute_instance_template" "loadgen" {
  name_prefix  = "loadgen-"
  machine_type = var.loadgen_machine_type

  # spot — 선점되면 run 은 verdict=INVALID 로 폐기 (FAIL 아님). soak(Phase 4)은 표준 VM 별도.
  # 무료 크레딧 계정도 spot 사용 가능(실증 확인 — PREEMPTIBLE_CPUS metric 이 0 이어도 C2_CPUS 로 생성됨).
  # 정말 spot 이 막힌 계정에서만 loadgen_use_spot=false 로 온디맨드 전환(CPUS 쿼터로 커버, 짧은 run 은 비용 무시).
  scheduling {
    provisioning_model          = var.loadgen_use_spot ? "SPOT" : "STANDARD"
    preemptible                 = var.loadgen_use_spot
    automatic_restart           = !var.loadgen_use_spot
    instance_termination_action = var.loadgen_use_spot ? "DELETE" : null
  }

  disk {
    source_image = local.vm_image
    boot         = true
    auto_delete  = true
    disk_size_gb = 20
    disk_type    = "pd-balanced"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id
    access_config {}
  }

  service_account {
    email  = local.sa_email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = file("${path.module}/scripts/install-docker.sh")

  tags = ["loadgen"]

  lifecycle {
    create_before_destroy = true
  }
}
