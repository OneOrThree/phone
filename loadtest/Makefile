# GROMO-548 부하테스트 딸깍 진입점 (PRD §6-1)
# 예) make test PROJECT_ID=gromo-loadtest-1 PROFILE=smoke TARGET=scenarios/daily_mix.js
# 진입점 3개(대시보드 버튼·Actions UI·이 Makefile)가 전부 같은 타겟을 실행한다.

# 단일 단어여야 함 — .ONESHELL 하에서 GNU Make(러너 4.3)는 SHELL 을 공백 분리하지 않아
# '/usr/bin/env bash' 처럼 인자가 붙으면 통째로 exec 하려다 'No such file' 로 실패한다.
# PATH 로 bash 를 찾는다(Mac=brew 최신 bash, 러너=/usr/bin/bash). macOS make 3.81 은 .ONESHELL 무시.
SHELL := bash
.ONESHELL:

PROJECT_ID ?=
REGION ?= asia-northeast3
ZONE ?= asia-northeast3-c
PROFILE ?= smoke
TARGET ?= scenarios/daily_mix.js
SEED_VERSION ?= seed-v2
SCALE ?= 1
# 고급 설정(expert) override — 빈값이면 k6 프로파일 기본값 사용 (run.sh 가 k6 __ENV 로 전달).
# rate 계열: RATE/DURATION(constant) · START_RATE(stress) · BASE_RATE/SPIKE_RATE(spike).
# 원격(workflow)은 PARAMS="KEY=VALUE;…" 하나로 받아 run.sh 가 파싱; 로컬 make 는 개별 변수도 가능.
RATE ?=
DURATION ?=
START_RATE ?=
BASE_RATE ?=
SPIKE_RATE ?=
PARAMS ?=
# 제네릭 러너용 recipe 목록(콤마구분, TARGET=matrix/_generic.js) + loadgen VM 수(고rps 분산 생성)
RECIPES ?=
SPOTS ?= 1
# 유저 시나리오 def id (TARGET=scenarios/_generic.js)
SCENARIO ?=

SHA := $(shell git rev-parse --short HEAD)
# SUT 이미지 — prod 와 같은 server/data-api/Dockerfile 을 핀 SHA 로 빌드 (make image)
IMAGE ?= $(REGION)-docker.pkg.dev/$(PROJECT_ID)/loadtest/gromo-back:$(SHA)
# := 로 1회 고정 — ?= 는 참조마다 date 를 재평가해 REPORT_DIR 이 초 경계에서 어긋나고,
# standalone make report/verdict 가 매번 새 타임스탬프를 만들어 직전 run 을 못 찾는다 (#183 리뷰).
# 워크플로우는 RUN_ID 를 command-line 인자로 넘기므로 := 여도 오버라이드된다.
RUN_ID := $(or $(RUN_ID),$(shell date -u +%Y%m%dT%H%M%SZ)-$(SHA))
TARGET_KEY := $(subst /,_,$(TARGET))
REPORT_DIR := reports/$(RUN_ID)-$(PROFILE)-$(TARGET_KEY)

export PROJECT_ID REGION ZONE PROFILE TARGET SEED_VERSION SCALE RATE DURATION START_RATE BASE_RATE SPIKE_RATE PARAMS RECIPES SPOTS SCENARIO REPORT_DIR IMAGE

.PHONY: help bootstrap check-quota infra-up image up up-base app-up down sync \
        seed seed-verify reset mint run collect verdict test \
        loadgen-up loadgen-down runner-up runner-down teardown report dashboard grafana baseline-promote guard

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
	docker build --platform linux/amd64 -t $(IMAGE) ../server/data-api
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

# 러너 온디맨드 제어 (GROMO-752) — MIG(loadtest-runner) 1↔0 resize. 대시보드 딸깍 전 runner-up, 끝나면 runner-down.
runner-up: guard
	gcloud compute instance-groups managed resize loadtest-runner --size=1 --zone=$(ZONE) --project=$(PROJECT_ID)
	@echo "→ 러너 기동·등록 ~1-2분. 확인: gh api repos/OneOrThree/phone/actions/runners --jq '.runners[]|[.name,.status]'"
runner-down: guard
	gcloud compute instance-groups managed resize loadtest-runner --size=0 --zone=$(ZONE) --project=$(PROJECT_ID)

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

# 이미 구성한 격리 서버의 공개 API 부하. golden reset·클라우드 기동 없이 실행한다.
# PARAMS_DIR은 해당 서버에 존재하는 세션의 users_uniform.json을 포함한 절대 경로.
# K6_SCRIPT로 다른 시나리오를 고른다. 쓰기 시나리오(island_switch·join_approval·letter_exchange·telescope_pin)는
# PARAMS_DIR에 write_fixture.json이 필요하다 — `make write-fixture`(로컬 스택 전용)로 만든다.
K6_SCRIPT ?= k6/scenarios/business_reads.js
.PHONY: test-existing
test-existing:
	@test -n "$(BASE_URL)" -a -n "$(PARAMS_DIR)" || { echo 'BASE_URL과 PARAMS_DIR 필요'; exit 1; }
	BASE_URL="$(BASE_URL)" PARAMS_DIR="$(PARAMS_DIR)" PROFILE="$(PROFILE)" \
	  k6 run $(K6_SCRIPT)

.PHONY: check
check:
	tests/seed-contract.sh

# 현재 전체 서버 조사. GCP 경로와 격리하며 Outbox/Kafka/Realtime 공유를 기본 활성화한다.
SURVEY_SIZES ?= 100,1000,10000
SURVEY_OUT ?= reports/matrix-$(RUN_ID)
.PHONY: local-build local-up local-down survey survey-report survey-check
local-build:
	@for service in data-api business-api realtime notification; do \
	  docker compose -f infra/local/compose.yml build "$$service" || exit $$?; \
	done

local-up: local-build
	docker compose -f infra/local/compose.yml up -d --wait

local-down:
	docker compose -f infra/local/compose.yml down

# survey/ 는 조사용 로컬 스크립트·결과(gitignored, .gitignore 의 /survey/) — 저장소에는 없다. 없으면 안내만 하고 멈춘다.
survey: survey-check
	python3 survey/matrix.py --out "$(SURVEY_OUT)" --sizes "$(SURVEY_SIZES)"

survey-report: survey-check
	python3 survey/aggregate.py "$(SURVEY_OUT)" "$(SURVEY_OUT)/summary"
	python3 survey/coverage.py "$(SURVEY_OUT)" "$(SURVEY_OUT)/summary/public-api-coverage.csv"
	python3 survey/tables.py "$(SURVEY_OUT)/summary"

survey-check:
	@for f in matrix.py aggregate.py coverage.py tables.py; do test -f "survey/$$f" || { echo "loadtest/survey/$$f 가 없습니다 — 조사 스크립트는 로컬 전용(gitignored)입니다. 조사 담당자에게 받아 loadtest/survey/ 에 두세요."; exit 2; }; done

# 공개 OpenAPI 전 operation × k6 시나리오 재대조 (GROMO-2346). 결과: docs/public-api-coverage.csv
# 스펙 갱신: scripts/coverage.py --refresh http://<business>/v0/api-docs/public
.PHONY: coverage coverage-check write-fixture
coverage:
	python3 scripts/coverage.py

coverage-check:
	python3 scripts/coverage.py --check

# 쓰기 시나리오용 slot fixture(계정 2 + 섬 3, SLOTS ≥ 시나리오 MAX_VUS). 로컬 격리 스택(localhost)에만 쓴다.
write-fixture:
	SLOTS="$(or $(SLOTS),50)" seed/60_write_fixture.sh
