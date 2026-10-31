# GROMO Datadog 연동 (dev · prod)

**인프라·컨테이너 메트릭 + 로그 + 앱 APM(분산 트레이싱) + 앱 커스텀 메트릭**을 Datadog(us5)로 push.
dev 는 기존 OSS 관측 스택(Prometheus/Grafana/Loki) 옆에 **토글 가능한 overlay**로 얹는다.
Gromo 1.x prod 는 `docker-compose.prod.yml` 에 **상시 내장**돼 있다. Catus V2 prod 의 Agent·컨테이너 라벨은
Infra 저장소가 소유하며 이 폴더의 overlay 를 쓰지 않는다(이름 기준은 아래 «이름 규칙»).
설계: `docs/superpowers/specs/2026-07-16-datadog-dev-design.md`.

## 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.datadog.yml` | **dev** — `datadog-agent` 서비스 + `data-api` override(-javaagent·서비스 태그·로그 라벨) |
| `docker-compose.prod.yml` | **Gromo 1.x prod** — 같은 배선을 app·nginx·datadog-agent 로 상시 포함 (Catus V2 아님) |
| `server/data-api/Dockerfile` | `dd-java-agent.jar` 내장 + **OpenMetrics AD 라벨**(아래 참고) |
| `server/data-api/src/main/resources/application-{dev,prod}.yml` | 관리 포트 9091 에 `/actuator/prometheus` 노출 |
| `.github/workflows/ops-datadog.dev.yml` | dev up/down/restart 토글 + **수집 검증 게이트** |
| `dashboards/gromo-dev-architecture.json` | dev 아키텍처 클릭 탐색 + Docker·Kafka·Redis 부하 통합 대시보드 (손으로 관리, 생성기 없음) |
| `dashboards/test_log_links.py` | Kafka 로그 링크 분리 검증 (`python3 -m unittest discover -s server/observability/datadog/dashboards -p 'test_*.py'`) |
| `pipelines/*.json` · `pipelines/manage.py` | Kafka Exporter·PostgreSQL 로그 심각도 파이프라인(티켓 2572). stderr 정상 로그의 error 오분류를 명시 매핑으로 보정한다 — **Datadog 미적용**. 적용·롤백 절차와 검증 범위는 `docs/architecture/server-log-observability/datadog-severity-pipeline.md` |
| `dashboards/cattus-app-rum.json` | cattus 전용 RUM — 세션·버전·화면·API·집중 명령 처리시간 |

## 이름 규칙 (env · host · service · source · container_name)

앱 4종은 `service` 를 **논리 이름**(`data-api` · `business-api` · `realtime` · `notification`)으로 통일하고
환경은 `env` 태그로만 가른다(`gromo-data-dev` 처럼 환경을 service 에 넣지 않는다). host 와 인프라 컴포넌트 이름은 바꾸지 않는다.
2026-10-30 Datadog 최근 24시간 실측을 기준으로 한다.

### dev (host `gromo-dev`, `env:dev`)

| 대상 | container_name | source | service |
|---|---|---|---|
| Data API | `phone-data-api` | `java` | `data-api` |
| Business API | `phone-business-api-1` | `java` | `business-api` |
| Realtime | `phone-realtime` | `java` | `realtime` |
| Notification | `phone-notification-1` | `java` | `notification` |
| Kafka 브로커 | `phone-kafka` | `kafka` | `gromo-kafka-dev` |
| Kafka Exporter | `gromo-kafka-exporter` | `kafka-exporter` | `gromo-kafka-dev` |
| PostgreSQL | `phone-db` | `postgres` | `gromo-db-dev`(컨테이너 라벨), 일부 로그 `postgres` |
| Redis | `phone-redis` | `redis` | `gromo-redis-dev` |

dev V2(GCP 분리 VM)는 Datadog 에 보고하는 호스트가 없어 이 표의 대상이 아니다(2026-10-31 호스트 목록 기준). 앱 compose 에 Agent·Datadog 라벨도 없다.

### prod V2 (host `catus-prod-V2`, `env:prod`)

| 대상 | container_name | source | service 적용 전(현재) | service 적용 후 |
|---|---|---|---|---|
| Data API | `catus-app-v2-app-1` | `java` | `catus-app-prod-V2` | `data-api` |
| Business API | (Infra compose) | `java` | `catus-business-api-prod-V2` | `business-api` |
| Realtime | (Infra compose) | 현재 `realtime-v2`, 적용 후 `java` | `catus-realtime-prod-V2` | `realtime` |
| Notification | (Infra compose) | `java` | `catus-notification-prod-V2` | `notification` |
| nginx · postgres · agent | — | `nginx` · `postgres` · `agent` | 그대로 | 그대로 |

- 일회성 service `data-api-v2`·`notification-v2` 는 일회성 컨테이너의 이름이다(원인 미확인). 앱 service 가 아니다.
- `catus-notification-dev`·`catus-business-api-dev` 는 V2 호스트에서 `env`·`service` 가 잘못 붙은 표기다(적용 뒤에는 사라진다).
- container_name 의 Business·Realtime·Notification 칸은 이 저장소에 정의가 없다. Infra 저장소가 정한다.
- **prod 에 넣을 값**: `OBS_SERVICE` · `DD_SERVICE` · `com.datadoghq.tags.service` 를 위 «적용 후» 논리 이름 4개로 같게 한다(Infra 저장소 작업).

### 구 Catus (host `catus-prod`) — 변경 없음

`catus-data-api-prod`(java, `catus-app-1`) · `catus-business-api-prod` · `catus-realtime-prod`(source `realtime`) ·
`catus-notification-prod` · `catus-kafka-prod` · `nginx` · `postgres` · `redis`. 앱 로그는 2026-10-29 23:49 UTC 이후 없다.

### Gromo 1.x (host `gromo-prod`) — 변경 없음

`gromo-back-prod`(source `gromo-prod-back`) · `gromo-nginx-prod`(nginx) · `postgres`. 수집 중이다.
`docker-compose.prod.yml` 이 만든다. 이 문서의 논리 이름 규칙 대상이 아니다.

### `OBS_SERVICE` 와 `DD_SERVICE` 가 다를 때

JSON 로그(`schema_version 1`)의 `service` 필드는 `OBS_SERVICE` 값이고, Datadog 은 이 필드를 **로그의 service 로 우선 사용**한다.
컨테이너 라벨(`com.datadoghq.tags.service`)과 `DD_SERVICE` 는 태그 `service:` 로 따로 붙는다. 그래서 둘이 다르면:

- 로그 목록의 표시 service = `OBS_SERVICE`, 태그 `service:` = 라벨 값. 예: dev 표본에서 표시 `data-api`, 태그 `service:gromo-data-dev`.
- APM(트레이스·서비스 맵) service = `DD_SERVICE`. 로그와 APM 이 다른 서비스로 갈라져 로그↔트레이스 연결이 끊긴다.

네 값(`OBS_SERVICE`·`DD_SERVICE`·라벨 `tags.service`·라벨 `ad.logs` 의 `service`)을 반드시 같게 둔다.
`OBS_SERVICE` 형식이 맞지 않으면 JSON 필드가 생략되고 로그 service 는 라벨 값으로 떨어진다.
`docker-compose.satellites.data.yml` 은 이 저장소의 prod compose 경로용이고 라벨이 없어 base prod compose 라벨과 갈린다. Catus V2 운영은 Infra 저장소 compose 를 쓰므로 이 파일의 `DD_SERVICE` 는 운영에 적용되지 않는다.
`server/data-api/Dockerfile` 의 `ad.logs` 라벨에는 service 키가 없으므로, compose 에서 같은 라벨 키로 덮어써 고정한다
(dev: `docker-compose.datadog.yml` data-api).

## cattus 앱 RUM 분리 (2026-10-29)

- RUM Application: **cattus**, React Native, US5. ID는 `31edaff8-b8b4-434b-9d8c-898e05a41255`.
- SDK 서비스는 `cattus-app`. 1.x의 `gromo-app`과 별도 Application ID로 수집한다.
- [cattus 앱 성능 대시보드](https://us5.datadoghq.com/dashboard/qp2-2ym-yyh).
  JSON은 `dashboards/cattus-app-rum.json`이 정본이다. 모든 쿼리에 cattus ID·서비스를 고정하고
  환경 기본값은 `prod`로 둔다. 버전·OS 필터로 배포 영향을 비교한다.
- iOS `testflight.sh`·Android CI·`scripts/ota-update.sh`가 `app/app-dev/ios/release-config.sh`의 새 ID·Client Token을
  읽는다. Client Token은 공개 SDK 수집 토큰이다. Datadog API/App Key를 앱에 넣지 않는다.
- 로컬 실행은 `app/app-dev/.env.example`의 두 Datadog 변수를 설정한다. 키가 없으면 수집을 끈다.
  `release-config.sh`는 셸에서 덮어쓴 ID가 옛 gromo ID면 실패하고, SDK도 해당 ID로 전송하지 않는다.
- 변경을 반영한 앱 빌드 또는 OTA부터 새 공간으로 보낸다. 기존 설치 버전의 전송 목적지와 과거 데이터는
  자동 변경·이동되지 않는다. 이전 cattus 기록은 기존 Application에서 `service:gromo-app-v2`로 조회한다.
- `sessionCommands.ts`는 집중 시작·항해 시작·종료 시 `focus_start`, `focus_sea_start`, `focus_finish`
  수동 Action을 기록한다. 문맥은 `operation`, `outcome`, `duration_ms`뿐이며 사용자 ID·과목·오류 내용은
  포함하지 않는다. 시간은 API와 상태 반영까지이며 화면 렌더 시간이나 집중 지속시간이 아니다.
- 처리시간 p95에는 `@context.duration_ms` Measure(millisecond), 명령 결과 필터에는
  `@context.operation`·`@context.outcome` Facet을 사용한다. 세 항목 모두 2026-10-29 콘솔에 등록했다.
  다른 조직에서 재구성할 때는 RUM Explorer의 **Add**에서 동일하게 등록한다.
- 오류·크래시·자동 터치 수집은 기존 설정대로 끈다. 빈 패널은 성공·무장애를 뜻하지 않는다.
  API 패널은 자사 prod/dev 호스트로 한정하며 리소스 타입으로 제한하지 않아 native 요청도 포함한다.

### 배포 후 수신 확인

1. 새 설정으로 빌드한 실기기에서 집중을 시작하고 종료한다.
2. RUM Explorer에서 `@application.id:31edaff8-b8b4-434b-9d8c-898e05a41255 service:cattus-app env:prod`
   (dev 빌드는 `env:dev`)로 화면·리소스·수동 Action을 확인한다.
3. 대시보드의 세션·화면·API 패널과 버전·OS 필터를 확인한다. 명령 p95는 Measure 등록 후 확인한다.
4. 리소스에 연결된 Trace가 있을 때 APM으로 이동한다. 서버의 계측·샘플링에 따라 연결이 없을 수 있다.

### OpenMetrics 브리지가 이미지 라벨에 있는 이유 (GROMO-1489)

앱 커스텀 메트릭(RED·HikariCP·JVM)은 Agent 의 `conf.d/openmetrics.d/conf.yaml` 로 설정할 수도 있지만,
**prod 호스트에는 레포가 체크아웃되지 않는다** — (옛, Gromo 1.x) prod CD 는 `docker-compose.prod.yml` 한 장만 S3 로
올렸다. 그래서 마운트 방식으로는 prod 에 브리지를 놓을 수 없었고, 결과적으로 커스텀 메트릭이 dev 에만 있었다.

지금은 `server/data-api/Dockerfile` 의 `com.datadoghq.ad.checks` 라벨에 스크레이프 설정을 구워, **같은 이미지가 어느
환경에서든 같은 배선**을 갖는다. 메트릭 목록을 바꾸려면 그 라벨 한 곳만 고치면 된다.

## dev ↔ prod(Gromo 1.x) 정합

두 환경은 **같은 항목을 같은 방식으로** 켠다. 값만 환경별로 다르다.

| | dev | prod |
|---|---|---|
| `DD_ENV` / `DD_SERVICE` | `dev` / `data-api` (앱 4종 논리 이름) | `prod` / `gromo-back-prod` (Gromo 1.x). Catus V2 는 위 «이름 규칙» |
| APM (`-javaagent`, 20% 샘플) | ✅ | ✅ |
| `DD_LOGS_INJECTION` | ✅ | ✅ |
| OpenMetrics 브리지 | ✅ (이미지 라벨) | ✅ (이미지 라벨) |
| 컨테이너 로그 파일 tail | ✅ | ✅ |
| 서비스 태그 라벨 | app · db | app · nginx |
| `DD_CONTAINER_EXCLUDE` | OSS 관측 컨테이너 제외 | agent 자신만 제외 |

`DD_CONTAINER_EXCLUDE` 만 다른 이유: dev 에는 OSS 관측 스택 7개(Prometheus·Grafana·Loki·Fluent Bit·exporter 류)가 함께 떠 있어 이중 수집·과금을 막아야 한다.

## 실행 (GitHub Actions)

리포 → Actions → **"Dev Datadog"** → Run workflow → `action` 선택:

- `up` — `datadog-agent` 기동 + `app` 을 APM overlay 로 재생성(-javaagent 활성).
- `restart` — 재시작.
- `down` — Datadog Agent 제거 + `app` 을 dev 파일 단독으로 재생성(평문, javaagent 없음) 복원.

> 이 워크플로는 OIDC·AWS Secrets Manager로 checkout 외부 `0600` runtime env를 job 마다 만들고 지운다(`.github/scripts/dev-env.sh`). 수동 관측 워크플로는 AWS 롤을 직접 인계하거나 시크릿을 다시 조회하지 않는다.

## 시크릿

- `DD_API_KEY` — **GitHub Actions 리포 시크릿**. `gh secret set DD_API_KEY` 또는 Settings → Secrets and variables → Actions. checkout에는 노출하지 않고 compose 실행·확인 step에만 주입한다.
- `DD_SITE` — `us5.datadoghq.com`(비밀 아님, 워크플로우 job env 하드코딩). Agent·APM 일치 필수.
- DB/app 시크릿(`POSTGRES_*`·`JWT_SECRET` 등) — 신 AWS 계정(`<account-id>`), 서울 리전(`ap-northeast-2`)의 Secrets Manager `gromo/dev/env` 사용.

dev 워크플로는 장기 AWS 키를 저장하지 않고 OIDC로 `gromo-dev-github-actions` 롤을 인계한다. 이 롤의
Secrets Manager 권한은 dev 시크릿 조회로 제한한다. Datadog·monitor 워크플로도 같은 롤로 SM 을 읽어
job 마다 임시 env 를 만들고 지운다(`.github/scripts/dev-env.sh`, GROMO-2224). VM 부트스트랩용 `gromo/dev/app-server`와 `gromo/dev/ci-runner`는 각 호스트의
인스턴스 롤만 읽으며 배포·관측 워크플로의 입력이 아니다. dev 이미지는 ECR이 아니라
GAR(`asia-northeast3-docker.pkg.dev/oneorthree2/ci-cache`)을 사용한다.

## 확인 위치 (Datadog UI, us5)

- **Infrastructure** > Host Map: `gromo-dev` / `catus-prod-V2`(Catus V2) / `gromo-prod`(Gromo 1.x) 호스트 + 컨테이너.
- **Logs**: 컨테이너 stdout tail. 앱 로그는 JSON 이라 `dd.trace_id` 가 담긴다(아래 "로그↔트레이스 상관").
- **APM** > Services: dev `data-api`·`business-api`·`realtime`·`notification`(`env:dev`), Gromo 1.x `gromo-back-prod`. 서비스·트레이스·플레임그래프.
- **Metrics Explorer**: `gromo.*`(OpenMetrics 브리지 — http RED, HikariCP, JVM). `env:dev`/`env:prod` 로 가른다.
- **Kafka 로그**: `service:gromo-kafka-dev` 는 브로커(`phone-kafka`, source `kafka`)와 Exporter 류
  (`gromo-kafka-exporter`, source `kafka-exporter`)가 함께 쓴다. 대시보드는 컨테이너·source 조건으로 링크를 둘로
  나눈다(service 태그·메트릭은 그대로). 근거와 반영 절차는 `docs/architecture/server-log-observability/kafka-log-links.md`.
- **Integrations > Kafka**: broker 처리량·지연·파티션과 JMX 상태. `kafka_cluster:gromo-dev`로 필터한다.
- **Integrations > Kafka Consumer**: consumer offset·lag. `kafka_cluster:gromo-dev`로 필터한다.
- **Integrations > Redis**: 공유 Redis의 메모리·연결·hit/miss·eviction·slowlog를 `redis_instance:shared`로 확인한다.

Kafka JMX `9999`와 Redis `6379`는 호스트에 publish하지 않는다. Agent는 `app-network`에 붙는다.
공유 Redis의 `health` ACL은 키 접근 없이 `PING`, `INFO`,
`CONFIG GET`, `SLOWLOG GET`만 허용한다. Datadog 공식 Redis check 최소 권한과 동일하다.

### 수집이 실제로 되는지 보는 법

배선이 붙은 것과 수집이 되는 것은 다르다. 2026-08-10 dev 에서 Agent 는 healthy, app 에 `-javaagent`·라벨도
정상이었지만 **컨테이너 로그가 2일간 0건**이었다(호스트 부하로 docker API 가 6초 → 로그 소스 자동탐지 실패).

```bash
docker exec gromo-datadog-agent agent status | grep -E 'LogsProcessed|Instance ID'
```

- `LogsProcessed: 0` → 로그 tailer 가 하나도 안 붙었다.
- `Instance ID: container|docker ... [ERROR]` → 컨테이너별 메트릭이 통째로 빈다.

dev 는 `ops-datadog.dev.yml` 의 **수집 검증** 스텝이 이 둘을 자동으로 어서션한다(0이면 워크플로 실패).

### 로그↔트레이스 상관 (dev Data API)

`DD_LOGS_INJECTION=true` 로 dd-java-agent 가 `dd.trace_id`/`dd.span_id` 를 MDC 에 넣고, 관측 JSON 콘솔
(`ObservationJsonProvider`, `CONSOLE_JSON`)이 이를 `dd.trace_id`·`dd.span_id` 로 출력한다. 따라서 `OBS_SERVICE` 와 `DD_SERVICE` 가
같으면 로그에서 같은 service 의 트레이스로 이동할 수 있다. 텍스트 콘솔을 쓰는 프로파일(local·ci)에는 상관이 없다.
Gromo 1.x prod 의 텍스트 패턴 로그는 상관되지 않는다.

## 비용 레버 (최소비용)

- dev 1 호스트. `DD_CONTAINER_EXCLUDE_LOGS` 로 OSS 관측 컨테이너 로그 수집 제외(이중 과금 방지).
- `DD_TRACE_SAMPLE_RATE=0.2`(dev 저부하). 안 볼 땐 `down`.
- OpenMetrics 는 `.*` 대신 큐레이트된 메트릭만(커스텀 메트릭 timeseries 과금).

## 다음 (Phase 3 — 별도 결정)

만족 시 dev 공동 배포에 상시 내장으로 승격 + Prometheus/Grafana/Loki 스택 폐기(`ops-monitor.dev.yml` down).

## service 이름 변경을 참조하는 Datadog 자원 (사람이 Datadog 에 반영)

저장소 JSON·compose 는 새 이름으로 고쳤다. 실제 Datadog 반영은 **담당자가 콘솔에서** 한다(이 저장소의 어떤 도구도 쓰기를 하지 않는다).

| 자원 | 참조하던 이름 | 반영할 것 |
|---|---|---|
| `dashboards/gromo-dev-architecture.json` 상단 note | `service:gromo-notification-dev` | 링크를 `service:notification` 으로. JSON 을 대시보드에 다시 적용 |
| 같은 파일 «상세 조사» note 의 APM 링크 4개 | `gromo-back-dev`·`gromo-business-dev`·`gromo-notification-dev`·`gromo-realtime-dev` | `data-api`·`business-api`·`notification`·`realtime` |
| 같은 파일 «서버 API» 위젯 3개(요청량·오류·p95) | `service:gromo-*` | `$env AND service IN (data-api,business-api,realtime,notification)`. 쉼표로 이으면 Datadog 이 400 으로 거부한다(`AND`·`OR` 와 `,` 혼용 불가, 2026-10-30 조회로 확인) |
| `dashboards/gromo-backend.json` 의 `service` 템플릿 변수 | 기본값 `gromo-back-prod`(Gromo 1.x) | 변경 없음. dev 를 볼 때는 값을 `data-api` 등으로 고른다 |
| 대시보드 `CATUS · DEV 통합 관측`(`hav-c4v-rkm`, Datadog 에만 있음) | `service:gromo-*`·`gromo-business-dev`·`gromo-data-dev` | 위젯 쿼리를 새 이름으로 교체 |
| Datadog 에만 있는 저장 뷰·로그 파이프라인·메트릭 필터 | 저장소에 없어 목록화 불가. 모니터·SLO 는 2026-10-31 기준 0건, prod 이름을 쓰는 대시보드도 0건 | 콘솔에서 `gromo-back-dev`·`gromo-data-dev`·`gromo-business-dev`·`gromo-realtime-dev`·`gromo-notification-dev` 로 검색해 새 이름으로 교체 |

절차: (1) dev 배포로 새 `DD_SERVICE`·라벨이 반영된 뒤 (2) 위 대시보드 JSON 을 적용하고 (3) 콘솔 검색으로 옛 service 참조를 정리한다.
배포 직후 약 1시간은 옛·새 service 가 한 시계열에 섞여 보일 수 있다. 과거 데이터는 옛 이름으로만 조회된다.
`dashboards/fixtures/*-before.json` 은 2573 의 «변경 전 고정»용이었으나 이 변경에서 새 이름으로 의도적으로 갱신했다.
