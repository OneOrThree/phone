variable "project_id" {
  description = "부하테스트 전용 GCP 프로젝트 ID (bootstrap.sh 로 생성)"
  type        = string
}

variable "region" {
  description = "리전 — 모든 리소스를 한 리전/존에 묶어 네트워크 변수 제거"
  type        = string
  default     = "asia-northeast3"
}

variable "zone" {
  type    = string
  default = "asia-northeast3-a"
}

# ── vCPU 예산 (무료체험 동시 8 상한): SUT 2 + 관측 2 + 부하 4 = 8 ──

variable "sut_machine_type" {
  description = "SUT VM — prod 동급 고정 스펙"
  type        = string
  default     = "n2-standard-2"
}

variable "sut_min_cpu_platform" {
  description = "run 간 하드웨어 일관성(baseline ±10% 판정) — e2 는 CPU 세대 랜덤 배정이라 n2+고정 사용"
  type        = string
  default     = "Intel Ice Lake"
}

variable "obs_machine_type" {
  description = "관측 VM (Prometheus·Grafana·postgres_exporter)"
  type        = string
  default     = "e2-small"
}

variable "loadgen_machine_type" {
  description = "부하 VM 템플릿 기본값 — C2 쿼터/재고 없으면 n2-highcpu-4 로 폴백"
  type        = string
  default     = "c2-standard-4"
}

variable "db_tier" {
  description = "Cloud SQL 스펙 — 데이터(~15GB) > RAM(8GB) 조건 유지가 전제"
  type        = string
  default     = "db-custom-2-8192"
}

variable "db_disk_size_gb" {
  type    = number
  default = 50
}

variable "grafana_allowed_cidrs" {
  description = "Grafana(3000) 접근 허용 개발자 IP 목록 (예: [\"1.2.3.4/32\"])"
  type        = list(string)
  default     = []
}

locals {
  sa_email = "loadtest-runner@${var.project_id}.iam.gserviceaccount.com"
  # Ubuntu LTS — docker compose 를 startup script 로 설치 (COS 는 compose 플러그인 부재)
  vm_image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
}
