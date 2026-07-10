# GROMO-548 부하테스트 상시 인프라 — Terraform 진입점
#
# 상태 버킷은 변수 사용 불가(backend 제약) → init 시 주입:
#   terraform init -backend-config="bucket=${PROJECT_ID}-tf-state"
# (make infra-up 이 자동으로 수행)
terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "gcs" {
    prefix = "loadtest"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
