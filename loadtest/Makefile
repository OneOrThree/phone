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
# 고급 설정(expert) override — 빈값이면 k6 프로파일 기본값 사용 (run.sh 가 k6 __ENV 로 전달)
RATE ?=
DURATION ?=

SHA := $(shell git rev-parse --short HEAD)
# SUT 이미지 — prod 와 같은 back/Dockerfile 을 핀 SHA 로 빌드 (make image)
IMAGE ?= $(REGION)-docker.pkg.dev/$(PROJECT_ID)/loadtest/gromo-back:$(SHA)
# := 로 1회 고정 — ?= 는 참조마다 date 를 재평가해 REPORT_DIR 이 초 경계에서 어긋나고,
# standalone make report/verdict 가 매번 새 타임스탬프를 만들어 직전 run 을 못 찾는다 (#183 리뷰).
# 워크플로우는 RUN_ID 를 command-line 인자로 넘기므로 := 여도 오버라이드된다.
RUN_ID := $(or $(RUN_ID),$(shell date -u +%Y%m%dT%H%M%SZ)-$(SHA))
TARGET_KEY := $(subst /,_,$(TARGET))
REPORT_DIR := reports/$(RUN_ID)-$(PROFILE)-$(TARGET_KEY)

export PROJECT_ID REGION ZONE PROFILE TARGET SEED_VERSION SCALE RATE DURATION REPORT_DIR IMAGE

.PHONY: help bootstrap check-quota infra-up image up up-base app-up down sync \
        seed seed-verify reset mint run collect verdict test \
        loadgen-up loadgen-down teardown report dashboard grafana baseline-promote guard

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
# trap 핸들러의 각 정리 명령을 || true 로 격리 — loadgen down 이 실패해도 down.sh(과금 차단)가
# set -e 로 스킵되지 않게 (#183 리뷰: teardown 부분 실행 방지)
test: guard
	@set -e
	trap 'scripts/loadgen.sh down || true; scripts/down.sh || true' EXIT
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

# Grafana 접속 — IAP TCP 포워딩(방화벽 개방 없이 gcloud 인증). IP 무관·인터넷 노출 0.
# 전제: make up 으로 관측 스택(Grafana 컨테이너)이 기동돼 있어야 함. Ctrl+C 로 터널 종료.
grafana: guard
	@echo "→ 브라우저에서 http://localhost:3000  (최초 admin/admin — 접속 후 비밀번호 변경 권장)"
	@echo "  Ctrl+C 로 터널 종료"
	gcloud compute start-iap-tunnel obs 3000 --local-host-port=localhost:3000 \
		--zone=$(ZONE) --project=$(PROJECT_ID)
