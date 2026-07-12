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

# ── vCPU 예산 (전역 CPUS_ALL_REGIONS=32): SUT 2 + 관측 2 + 러너 2 + 부하 4×SPOTS(≤6) = 최대 30 ──

variable "sut_machine_type" {
  description = "SUT VM — prod 동급 고정 스펙. n2(인텔)는 a존 stockout 반복으로 시작 실패 이력 — AMD(n2d) 재고 풀 사용"
  type        = string
  default     = "n2d-standard-2"
}

variable "sut_min_cpu_platform" {
  description = "run 간 하드웨어 일관성(baseline ±10% 판정) — e2 는 CPU 세대 랜덤 배정이라 세대 고정 필수. n2d 의 최신 세대가 Milan 이라 '최소 Milan' = 사실상 Milan 고정. 존별 가용성은 apply 가 검증. 단 GCP 가 n2d 에 Milan 이후 세대를 추가하면 plan 은 No changes 인 채 신세대에 배치될 수 있음 — 그때 명시 핀 재검토(릴리스 노트 확인)"
  type        = string
  default     = "AMD Milan"
}

variable "obs_machine_type" {
  description = "관측 VM (Prometheus·Grafana·postgres_exporter)"
  type        = string
  default     = "e2-small"
}

variable "loadgen_machine_type" {
  description = "부하 VM 템플릿 기본값(n2-highcpu-4, 4vCPU) — SPOTS 대 수평 확장(GROMO-763). C2_CPUS=8 우회(N2 는 리전 200). c2-standard-4 는 옵션"
  type        = string
  default     = "n2-highcpu-4"
}

variable "loadgen_use_spot" {
  description = "부하 VM 을 spot 으로 띄울지 — 무료 크레딧 계정은 spot 불가라 false(온디맨드)로. 유료면 true 권장(저렴·선점 무효처리)"
  type        = bool
  default     = true
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
