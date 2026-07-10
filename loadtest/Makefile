# GROMO-548 부하테스트 딸깍 진입점 (PRD §6-1)
# 예) make test PROJECT_ID=gromo-loadtest-1 PROFILE=smoke TARGET=scenarios/daily_mix.js
# 진입점 3개(대시보드 버튼·Actions UI·이 Makefile)가 전부 같은 타겟을 실행한다.

SHELL := /usr/bin/env bash
.ONESHELL:

PROJECT_ID ?=
REGION ?= asia-northeast3
ZONE ?= asia-northeast3-a
PROFILE ?= smoke
TARGET ?= scenarios/daily_mix.js
SEED_VERSION ?= seed-v1
SCALE ?= 1

SHA := $(shell git rev-parse --short HEAD)
# SUT 이미지 — prod 와 같은 back/Dockerfile 을 핀 SHA 로 빌드 (make image)
IMAGE ?= $(REGION)-docker.pkg.dev/$(PROJECT_ID)/loadtest/gromo-back:$(SHA)
RUN_ID ?= $(shell date -u +%Y%m%dT%H%M%SZ)-$(SHA)
TARGET_KEY := $(subst /,_,$(TARGET))
REPORT_DIR ?= reports/$(RUN_ID)-$(PROFILE)-$(TARGET_KEY)

export PROJECT_ID REGION ZONE PROFILE TARGET SEED_VERSION SCALE REPORT_DIR IMAGE

.PHONY: help bootstrap check-quota infra-up image up up-base app-up down sync \
        seed seed-verify reset mint run collect verdict test \
        loadgen-up loadgen-down teardown report dashboard baseline-promote guard

help:
	@grep -E '^[a-z-]+:' Makefile | cut -d: -f1 | sort | tr '\n' ' '; echo

guard:
	@test -n "$(PROJECT_ID)" || { echo "PROJECT_ID 필요 (예: make ... PROJECT_ID=gromo-loadtest-1)"; exit 1; }

# ── 1회성: 부트스트랩·인프라·이미지 ─────────────────────────
bootstrap: guard
	infra/bootstrap/bootstrap.sh

check-quota: guard
	infra/bootstrap/check-quota.sh

infra-up: guard
	cd infra/terraform && \
	terraform init -backend-config="bucket=$(PROJECT_ID)-tf-state" -input=false && \
	terraform apply -var "project_id=$(PROJECT_ID)"

image: guard
	docker build --platform linux/amd64 -t $(IMAGE) ../back
	gcloud auth configure-docker $(REGION)-docker.pkg.dev --quiet
	docker push $(IMAGE)

# ── 기동/중지 — down 이 곧 과금 차단 ────────────────────────
up-base: guard        ## SQL·VM 기동 + sync + 관측 스택 (app 은 reset 뒤에)
	scripts/up.sh base

app-up: guard         ## SUT app 기동 — reset 후 실행 (app 접속이 DROP 을 막음)
	scripts/up.sh app

up: up-base app-up

down: guard
	scripts/down.sh

sync: guard
	scripts/sync.sh

# ── 데이터 ──────────────────────────────────────────────────
seed: guard           ## golden 생성 (수십 분). SCALE=0.01 로 파이프라인 디버그
	seed/seed.sh

seed-verify: guard
	. scripts/common.sh && obs_psql loadtest '-f ~/seed/95_verify.sql'

reset: guard          ## loadtest ← golden 복제 (분 단위)
	scripts/reset.sh

mint: guard           ## JWT 재발급 (만료 임박 시) — params 를 내려받아 재서명 후 재업로드
	. scripts/common.sh
	TMP=$$(mktemp -d)
	gcloud storage cp -r "gs://$(PROJECT_ID)-params/$(SEED_VERSION)/*" "$$TMP/"
	JWT_SECRET=$$(gcloud secrets versions access latest --secret=loadtest-jwt-secret --project=$(PROJECT_ID)) \
	  node seed/50_mint_jwt.mjs "$$TMP"
	gcloud storage cp -r "$$TMP"/* "gs://$(PROJECT_ID)-params/$(SEED_VERSION)/"

# ── run 파이프라인 ──────────────────────────────────────────
loadgen-up: guard
	scripts/loadgen.sh up

loadgen-down: guard
	scripts/loadgen.sh down

run: guard
	scripts/run.sh

collect: guard
	scripts/collect.sh

verdict:
	node scripts/verdict.mjs $(REPORT_DIR)

# 딸깍 — 실패해도 teardown 이 보장되고, verdict 의 exit 코드(PASS=0/FAIL=1/INVALID=2)가 전파된다
test: guard
	@set -e
	trap 'scripts/loadgen.sh down; scripts/down.sh' EXIT
	scripts/up.sh base
	scripts/reset.sh
	scripts/up.sh app
	scripts/loadgen.sh up
	scripts/run.sh
	scripts/collect.sh
	node scripts/verdict.mjs $(REPORT_DIR)

teardown: loadgen-down down

report:
	@cat $(REPORT_DIR)/verdict.json 2>/dev/null || { echo "최근 run:"; ls -t reports 2>/dev/null | head -5; }

# baseline 승격 — 파일 생성만. 커밋·PR·머지는 사람 승인 (자동 갱신 금지)
baseline-promote:
	@test -n "$(RUN)" || { echo "RUN=reports/<run-dir> 필요"; exit 1; }
	node scripts/verdict.mjs --promote $(RUN)

dashboard:
	@test -d dashboard || { echo "대시보드는 M9 에서 추가 예정"; exit 1; }
	cd dashboard && npm install && npm run dev
