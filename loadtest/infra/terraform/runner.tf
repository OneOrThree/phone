# loadtest 전용 self-hosted 러너 (GROMO-752) — 대시보드 딸깍(workflow_dispatch)의 실행기.
#
# 왜 여기(gromo-stress)에: 러너 VM 은 loadgen/obs 와 같은 VPC·IAP 안에 있어야 하고, WIF 는
#   "GitHub job → GCP SA 사칭"(인증)일 뿐 러너 "등록"(VM → GitHub) 은 별개라 GitHub 크리덴셜이
#   필요하다. 그 크리덴셜을 이 프로젝트 Secret Manager 에 두고 러너가 자기 SA 로 읽는다.
# 등록 크리덴셜: oneorthree/ci-runner 와 같은 GitHub App 재사용(값만 이 프로젝트 시크릿에 수동 주입).
# 온디맨드: MIG target_size=0 (유휴 비용 0) → make runner-up 이 1 로 resize, runner-down 이 0 으로.

variable "enable_runner" {
  description = "loadtest 러너 MIG 생성 여부. 활성화 전 loadtest-runner-gh-app 시크릿(ci-runner GitHub App creds)을 수동 주입해야 함."
  type        = bool
  default     = false
}

variable "runner_machine_type" {
  description = "러너 VM — 오케스트레이션(gcloud/ssh/node)만 하므로 작게(실제 부하는 loadgen VM 소관)"
  type        = string
  default     = "e2-standard-2"
}

variable "github_repo" {
  description = "러너가 등록될 GitHub 레포 (loadtest.yml 이 도는 곳)"
  type        = string
  default     = "OneOrThree/phone"
}

# 러너 등록용 GitHub App 크리덴셜 — 값은 수동 주입(JSON: GITHUB_APP_ID/INSTALLATION_ID/GITHUB_APP_PEM/RUNNER_ORG/RUNNER_REPO).
# 러너 VM 이 자기 SA(project secretmanager.admin 보유)로 읽어 App JWT→installation token→러너 등록토큰 발급.
# enable_runner 와 무관하게 항상 생성 — 활성화 전에 미리 주입해 둘 수 있도록.
resource "google_secret_manager_secret" "runner_gh_app" {
  secret_id = "loadtest-runner-gh-app"
  replication {
    auto {}
  }
}

# Spot 인스턴스 템플릿 — 러너는 짧은 run 동안만 필요, spot 으로 저렴하게. 선점 시 MIG 가 재생성→재등록.
resource "google_compute_instance_template" "runner" {
  count        = var.enable_runner ? 1 : 0
  name_prefix  = "loadtest-runner-"
  machine_type = var.runner_machine_type

  scheduling {
    provisioning_model          = "SPOT"
    preemptible                 = true
    automatic_restart           = false
    instance_termination_action = "STOP" # MIG 와 함께: STOP 된 VM 을 MIG 가 감지해 재생성
  }

  disk {
    source_image = local.vm_image
    boot         = true
    auto_delete  = true
    disk_size_gb = 30
    disk_type    = "pd-balanced"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id
    access_config {} # 러너 등록·GitHub API·러너 패키지 다운로드에 외부 IP 필요
  }

  service_account {
    email  = local.sa_email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = templatefile("${path.module}/scripts/runner-startup.sh", {
      github_repo = var.github_repo
      gh_secret   = google_secret_manager_secret.runner_gh_app.secret_id
    })
  }

  tags = ["loadtest-runner"] # IAP SSH 방화벽은 태그 없음(전 VM) 이라 별도 규칙 불필요

  lifecycle {
    create_before_destroy = true
  }
}

# 관리형 인스턴스 그룹 — target_size=0(온디맨드). autoscaler 없음(GCP autoscaler 는 GitHub 큐로
# 스케일업 불가). make runner-up/down 이 resize 로 1↔0 제어. 선점 시 MIG 가 자동 재생성.
resource "google_compute_instance_group_manager" "runner" {
  count              = var.enable_runner ? 1 : 0
  name               = "loadtest-runner"
  zone               = var.zone
  base_instance_name = "loadtest-runner"
  target_size        = 0

  version {
    instance_template = google_compute_instance_template.runner[0].id
  }
}
