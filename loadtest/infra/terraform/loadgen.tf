# 부하 VM — 인스턴스 템플릿만 terraform 관리. VM 자체는 run 마다 scripts/loadgen.sh 가
# 생성·삭제한다(spot 이라 빠른 create/delete 가 tf apply 보다 적합). 고정 이름 `loadgen` 으로
# 생성해 내부 DNS(loadgen.*.c.<project>.internal)가 재생성에도 안정 — Prometheus 타겟 유지.
resource "google_compute_instance_template" "loadgen" {
  name_prefix  = "loadgen-"
  machine_type = var.loadgen_machine_type

  # spot — 선점되면 run 은 verdict=INVALID 로 폐기 (FAIL 아님). soak(Phase 4)은 표준 VM 별도.
  scheduling {
    provisioning_model          = "SPOT"
    preemptible                 = true
    automatic_restart           = false
    instance_termination_action = "DELETE"
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
