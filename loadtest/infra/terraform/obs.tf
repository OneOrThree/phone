# 관측 VM — Prometheus(+remote-write receiver)·Grafana·postgres_exporter.
# SUT 와 분리해 관측 오버헤드가 측정을 오염하지 않게 한다. 디스크는 중지 후에도 보존되어
# run 간 히스토리 비교가 가능하다 (Prometheus 보존 7d).
resource "google_compute_instance" "obs" {
  name         = "obs"
  machine_type = var.obs_machine_type
  zone         = var.zone
  tags         = ["obs"]

  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = local.vm_image
      size  = 30 # Prometheus TSDB + Grafana
      type  = "pd-balanced"
    }
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

  desired_status = "RUNNING"
  lifecycle {
    ignore_changes = [desired_status]
  }
}
