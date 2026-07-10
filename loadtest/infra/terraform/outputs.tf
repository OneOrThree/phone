output "sut_internal_ip" {
  value       = google_compute_instance.sut.network_interface[0].network_ip
  description = "부하 대상 주소 (k6 BASE_URL=http://<ip>:8080)"
}

output "obs_internal_ip" {
  value       = google_compute_instance.obs.network_interface[0].network_ip
  description = "Prometheus remote-write·스크레이프 허브"
}

output "obs_external_ip" {
  value       = google_compute_instance.obs.network_interface[0].access_config[0].nat_ip
  description = "Grafana 접속용 (3000, 허용 IP 한정)"
}

output "sql_private_ip" {
  value       = google_sql_database_instance.loadtest.private_ip_address
  description = "Cloud SQL 사설 IP — SUT datasource·postgres_exporter 타겟"
}

output "sql_instance" {
  value = google_sql_database_instance.loadtest.name
}

output "params_bucket" {
  value = google_storage_bucket.params.url
}

output "reports_bucket" {
  value = google_storage_bucket.reports.url
}

output "image_repo" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  description = "SUT 이미지 push/pull 경로"
}

output "loadgen_template" {
  value       = google_compute_instance_template.loadgen.self_link
  description = "scripts/loadgen.sh 가 run 마다 이 템플릿으로 VM 생성"
}
