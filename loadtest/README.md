# loadtest — gromo 부하테스트 하네스 (GROMO-548)

버튼 하나(딸깍)로 부하테스트를 실행·판정·비교하는 하네스. 상세 기획은 **[docs/prd.md](docs/prd.md)**,
아키텍처 원천은 `knowledge/topics/부하테스트-아키텍처.md` v2.

## 퀵스타트 (Phase 0 완성 후)

```bash
# 1회: GCP 부트스트랩 + 인프라 + 시드
make bootstrap        # 프로젝트·API·TF 상태·WIF (수동 단계는 infra/bootstrap/README.md)
make infra-up         # terraform apply
make seed             # golden DB (~6,500만 건, 수십 분)

# 딸깍
make test PROFILE=smoke TARGET=scenarios/daily_mix.js   # 로컬 딸깍
make dashboard                                          # 대시보드(트리거·히스토리·판정·diff)
# 또는 GitHub Actions → loadtest.yml → Run workflow
```

## 아키텍처

**딸깍(트리거) → GitHub Actions → GCP** 전체 흐름. 진입점 3개(대시보드·Actions UI·로컬 make)가 같은
`make test` 파이프라인을 실행한다. 원격 2개는 GitHub Actions의 **전용 self-hosted 러너**(온디맨드 spot)를
타고, 러너는 **WIF(키리스)** 로 gromo-stress를 조종한다.

### 전체 구성

```mermaid
flowchart TB
  subgraph TRIG["진입점"]
    DASH["대시보드 SPA · 딸깍"]
    UIACT["Actions UI"]
    LOCAL["로컬 make test"]
  end

  subgraph GH["GitHub · OneOrThree/phone"]
    WD{{workflow_dispatch}}
    WF["Loadtest 워크플로<br/>runs-on: self-hosted, loadtest"]
    RPT[("loadtest-reports 브랜치<br/>verdict·summary·pg_top20")]
  end

  DASH -->|GitHub API| WD
  UIACT --> WD
  WD --> WF

  subgraph GCP["GCP · gromo-stress"]
    RVM["loadtest-runner<br/>MIG spot · 온디맨드"]
    WIF["WIF · OIDC→SA (키리스)"]
    MT(["make test 오케스트레이션"])
    SM[["Secret Manager<br/>gh-app·jwt·db"]]
    AR[["Artifact Registry"]]
    GCS[["GCS · params"]]

    subgraph VPC["VPC · 사설IP · IAP"]
      SQL[("Cloud SQL PG16<br/>golden ⇒ loadtest 복제")]
      OBS["obs VM<br/>Prometheus·Grafana·pg-exporter"]
      SUTV["SUT VM<br/>app :8080·:9091 · node :9100"]
      LG["loadgen VM · spot<br/>k6 · node :9100"]
    end
  end

  WF -->|job| RVM
  RVM --> WIF
  RVM --> MT
  LOCAL -.->|랩탑에서 직접| MT
  MT -.->|creds| SM
  MT -->|make image| AR
  MT -.->|params| GCS

  MT ==>|① up: SQL·VM 기동| SQL
  MT ==> OBS
  MT ==>|③ SUT app| SUTV
  MT ==>|④ loadgen up| LG

  LG -->|⑤ k6 부하 :8080| SUTV
  LG -->|k6 metrics| OBS
  OBS -.->|스크레이프| SUTV
  OBS -.->|스크레이프| LG
  OBS -.->|pg-exporter| SQL

  MT -->|⑦ verdict·리포트| RPT
  OBS -.->|IAP 터널| DASH
```

### make test 런타임 순서

```mermaid
sequenceDiagram
  autonumber
  participant R as 러너 / 랩탑
  participant SQL as Cloud SQL
  participant OBS as obs VM
  participant SUT as SUT VM
  participant LG as loadgen VM
  R->>SQL: up.sh base — 기동(activation ALWAYS)
  R->>SUT: VM start
  R->>OBS: VM start + 관측 스택 up
  R->>SQL: reset — CREATE DATABASE loadtest TEMPLATE golden
  R->>SUT: up.sh app — 이미지 pull·Flyway validate·/health
  R->>LG: loadgen up(spot) + node-exporter
  LG->>SUT: k6 워밍업 2분 → 본측정 (:8080)
  LG-->>OBS: k6 metrics (remote-write)
  OBS-->>SUT: 스크레이프 :9091 micrometer · :9100 node
  OBS-->>LG: 스크레이프 :9100 node (부하기 CPU 가드)
  R->>OBS: collect — pg_top20(psql)·loadgen CPU(promQL)
  R->>R: verdict — PASS / FAIL / INVALID
  R->>LG: teardown — loadgen 삭제
  R->>SQL: down — SQL·VM 중지 (과금 차단)
```

- **golden 템플릿**: 시드 1회 → `IS_TEMPLATE` 동결, run마다 `TEMPLATE` 복제(reset). 부하는 복제본(loadtest)에만.
- **온디맨드 러너**: 평시 MIG 0대(비용 0), `make runner-up`으로 1대 → 자기 등록(GitHub App creds from Secret Manager). loadgen(spot)도 run마다 생성·삭제.
- **관측**: Prometheus가 SUT(micrometer·node)·loadgen(node)·Cloud SQL(pg-exporter)을 스크레이프하고 k6는 remote-write. Grafana는 인터넷 노출 0, IAP 터널로만 접근.

## 디렉토리

| 경로 | 내용 |
|---|---|
| `docs/` | PRD 등 기획 문서 |
| `infra/bootstrap/` | GCP 1회 부트스트랩 스크립트 |
| `infra/terraform/` | 상시 인프라 (VPC·Cloud SQL·SUT·관측 VM·템플릿) |
| `infra/sut/` `infra/obs/` | SUT·관측 VM docker compose |
| `seed/` | golden DB 시드 파이프라인 (Flyway 스키마 + SQL 데이터 + params/JWT) |
| `k6/` | 부하 스크립트 (lib/profiles/matrix/scenarios) |
| `grafana/` | 부하테스트 전용 대시보드 JSON |
| `scripts/` | run 오케스트레이션 (loadgen·run·collect·verdict) |
| `dashboard/` | 개발자 대시보드 SPA (Vite+React) |
| `reports/baseline/` | 회귀 비교 기준 (사람 승인 PR로만 갱신) |

## 운영 원칙

- **평시 전부 중지** — `make down`이 곧 과금 차단. 부하 VM(spot)은 run마다 생성·삭제.
- run 비교는 **메타(sha·seed·스펙) 동일**할 때만 유효 — 다르면 verdict가 diff를 거부한다.
- 실부하 DB에 `EXPLAIN ANALYZE` 금지 — 심층 분석은 `analysis` 클론에서.
