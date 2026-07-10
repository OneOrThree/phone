# VPC — 부하기·SUT·DB 를 같은 리전/존 사설 네트워크에 묶어 네트워크 변수·비용 제거
resource "google_compute_network" "loadtest" {
  name                    = "loadtest-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  name          = "loadtest-subnet"
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.loadtest.id
}

# Private Service Access — Cloud SQL 사설 IP 용 (1회 사전 설정, 부하테스트-아키텍처 §GCP 체크포인트)
resource "google_compute_global_address" "psa_range" {
  name          = "loadtest-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.loadtest.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.loadtest.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa_range.name]
}

# ── 방화벽 ──────────────────────────────────────────────────
# ssh 는 IAP 터널로만 (VM 공개 IP 는 이미지 pull 용 egress 전용 — 인바운드 차단)
resource "google_compute_firewall" "allow_iap_ssh" {
  name          = "loadtest-allow-iap-ssh"
  network       = google_compute_network.loadtest.name
  source_ranges = ["35.235.240.0/20"] # Cloud IAP 고정 대역

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# 서브넷 내부 상호 통신 (부하→SUT 8080, 스크레이프 9091/9100/9187, k6 RW 9090 등)
# 전용 실험 VPC 라 내부는 tcp 전체 허용 — 포트 추가 때마다 규칙을 안 늘리기 위한 단순화
resource "google_compute_firewall" "allow_internal" {
  name          = "loadtest-allow-internal"
  network       = google_compute_network.loadtest.name
  source_ranges = [google_compute_subnetwork.main.ip_cidr_range]

  allow {
    protocol = "tcp"
    ports    = ["1-65535"]
  }
  allow {
    protocol = "icmp"
  }
}

# Grafana 만 개발자 IP 허용목록으로 외부 공개
resource "google_compute_firewall" "allow_grafana" {
  count         = length(var.grafana_allowed_cidrs) > 0 ? 1 : 0
  name          = "loadtest-allow-grafana"
  network       = google_compute_network.loadtest.name
  source_ranges = var.grafana_allowed_cidrs
  target_tags   = ["obs"]

  allow {
    protocol = "tcp"
    ports    = ["3000"]
  }
}
