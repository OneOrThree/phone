# GROMO Datadog 연동 (dev · prod)

**인프라·컨테이너 메트릭 + 로그 + 앱 APM(분산 트레이싱) + 앱 커스텀 메트릭**을 Datadog(us5)로 push.
dev 는 기존 OSS 관측 스택(Prometheus/Grafana/Loki) 옆에 **토글 가능한 overlay**로 얹고,
prod 는 `docker-compose.prod.yml` 에 **상시 내장**돼 있다.
설계: `docs/superpowers/specs/2026-07-16-datadog-dev-design.md`.

## 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.datadog.yml` | **dev** — `datadog-agent` 서비스 + `app`/`db` override(-javaagent·서비스 태그) |
| `docker-compose.prod.yml` | **prod** — 같은 배선을 app·nginx·datadog-agent 로 상시 포함 |
| `server/data-api/Dockerfile` | `dd-java-agent.jar` 내장 + **OpenMetrics AD 라벨**(아래 참고) |
| `server/data-api/src/main/resources/application-{dev,prod}.yml` | 관리 포트 9091 에 `/actuator/prometheus` 노출 |
| `.github/workflows/ops-datadog.dev.yml` | dev up/down/restart 토글 + **수집 검증 게이트** |
| `dashboards/gromo-dev-architecture.json` | dev 아키텍처 클릭 탐색 + Docker·Kafka·Redis 부하 통합 대시보드 (손으로 관리, 생성기 없음) |
| `dashboards/test_log_links.py` | Kafka 로그 링크 분리 검증 (`python3 -m unittest discover -s server/observability/datadog/dashboards -p 'test_*.py'`) |
| `dashboards/cattus-app-rum.json` | cattus 전용 RUM — 세션·버전·화면·API·집중 명령 처리시간 |

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
**prod 호스트에는 레포가 체크아웃되지 않는다** — (옛) `prod-cd.yml` 은 `docker-compose.prod.yml` 한 장만 S3 로
올린다. 그래서 마운트 방식으로는 prod 에 브리지를 놓을 수 없었고, 결과적으로 커스텀 메트릭이 dev 에만 있었다. `prod-cd.yml` 은 GROMO-2224 에서 삭제됐다.

지금은 `server/data-api/Dockerfile` 의 `com.datadoghq.ad.checks` 라벨에 스크레이프 설정을 구워, **같은 이미지가 어느
환경에서든 같은 배선**을 갖는다. 메트릭 목록을 바꾸려면 그 라벨 한 곳만 고치면 된다.

## dev ↔ prod 정합

두 환경은 **같은 항목을 같은 방식으로** 켠다. 값만 환경별로 다르다.

| | dev | prod |
|---|---|---|
| `DD_ENV` / `DD_SERVICE` | `dev` / `gromo-back-dev` | `prod` / `gromo-back-prod` |
| APM (`-javaagent`, 20% 샘플) | ✅ | ✅ |
| `DD_LOGS_INJECTION` | ✅ | ✅ |
| OpenMetrics 브리지 | ✅ (이미지 라벨) | ✅ (이미지 라벨) |
| 컨테이너 로그 파일 tail | ✅ | ✅ |
| 서비스 태그 라벨 | app · db | app · nginx |
| `DD_CONTAINER_EXCLUDE` | OSS 관측 컨테이너 제외 | agent 자신만 제외 |

`DD_CONTAINER_EXCLUDE` 만 다른 이유: dev 에는 OSS 관측 스택 7개가 함께 떠 있어 이중 수집·과금을 막아야 한다.

## 실행 (GitHub Actions)

리포 → Actions → **"Dev Datadog"** → Run workflow → `action` 선택:

- `up` — `datadog-agent` 기동 + `app` 을 APM overlay 로 재생성(-javaagent 활성).
- `restart` — 재시작.
- `down` — Datadog Agent 제거 + `app` 을 dev 파일 단독으로 재생성(평문, javaagent 없음) 복원.

> `cd.yml`이 OIDC·AWS Secrets Manager로 만든 checkout 외부 `0600` runtime env를
> `ops-monitor.dev.yml`과 함께 재사용한다. 수동 관측 워크플로는 AWS 롤을 직접 인계하거나 시크릿을 다시 조회하지 않는다.

## 시크릿

- `DD_API_KEY` — **GitHub Actions 리포 시크릿**. `gh secret set DD_API_KEY` 또는 Settings → Secrets and variables → Actions. checkout에는 노출하지 않고 compose 실행·확인 step에만 주입한다.
- `DD_SITE` — `us5.datadoghq.com`(비밀 아님, 워크플로우 job env 하드코딩). Agent·APM 일치 필수.
- DB/app 시크릿(`POSTGRES_*`·`JWT_SECRET` 등) — 신 AWS 계정(`808715036056`), 서울 리전(`ap-northeast-2`)의 Secrets Manager `gromo/dev/env` 사용.

`cd.yml`은 장기 AWS 키를 저장하지 않고 OIDC로 `gromo-dev-github-actions` 롤을 인계한다. 이 롤의
Secrets Manager 권한은 dev 시크릿 조회로 제한한다. Datadog·monitor 워크플로도 같은 롤로 SM 을 읽어
job 마다 임시 env 를 만들고 지운다(`.github/scripts/dev-env.sh`, GROMO-2224). VM 부트스트랩용 `gromo/dev/app-server`와 `gromo/dev/ci-runner`는 각 호스트의
인스턴스 롤만 읽으며 배포·관측 워크플로의 입력이 아니다. dev 이미지는 ECR이 아니라
GAR(`asia-northeast3-docker.pkg.dev/oneorthree2/ci-cache`)을 사용한다.

## 확인 위치 (Datadog UI, us5)

- **Infrastructure** > Host Map: `gromo-dev` / `gromo-prod` 호스트 + 컨테이너.
- **Logs**: 컨테이너 stdout tail. ⚠️ 아래 "로그↔트레이스 상관" 참고 — 자동 상관은 아직 미완.
- **APM** > Services: `gromo-back-dev` / `gromo-back-prod` 서비스·트레이스·플레임그래프.
- **Metrics Explorer**: `gromo.*`(OpenMetrics 브리지 — http RED, HikariCP, JVM). `env:dev`/`env:prod` 로 가른다.
- **Kafka 로그**: `service:gromo-kafka-dev` 는 브로커(`phone-kafka`, source `kafka`)와 Exporter 류
  (`gromo-kafka-exporter`, source `kafka-exporter`)가 함께 쓴다. 대시보드는 컨테이너·source 조건으로 링크를 둘로
  나눈다(service 태그·메트릭은 그대로). 근거와 반영 절차는 `docs/architecture/server-log-observability/kafka-log-links.md`.
- **Integrations > Kafka**: broker 처리량·지연·파티션과 JMX 상태. `kafka_cluster:gromo-dev`로 필터한다.
- **Integrations > Kafka Consumer**: consumer offset·lag. `kafka_cluster:gromo-dev`로 필터한다.
- **Integrations > Redis**: 공유 Redis와 Business Redis의 메모리·연결·hit/miss·eviction·slowlog.
  `redis_instance:shared|business`로 구분한다.

Kafka JMX `9999`와 Redis `6379`는 호스트에 publish하지 않는다. Agent는 `app-network`와 internal
`business-cache`에만 붙는다. Business Redis의 `health` ACL은 키 접근 없이 `PING`, `INFO`,
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

### 로그↔트레이스 상관 (미완, 알려진 한계 — dev·prod 공통)

`DD_LOGS_INJECTION=true` 로 dd-java-agent 가 `dd.trace_id`/`dd.span_id` 를 MDC 에 넣어두지만, 앱의
`logback-spring.xml` CONSOLE appender 는 **텍스트 패턴**이고 앱 자체 `trace_id` 키만 찍는다. 따라서 Agent 가
tail 하는 stdout 로그에는 Datadog 이 상관에 쓰는 `dd.trace_id` 가 구조화되어 담기지 않아 **자동 로그↔트레이스
상관은 아직 동작하지 않는다.** 완성하려면 둘 중 하나 필요 (Phase 3 후보):
- **JSON 콘솔**: `datadog` 전용 springProfile 에서 `dd.trace_id`/`dd.span_id` 를 포함한 JSON encoder 로 stdout 출력.
- **Datadog 로그 파이프라인(서버측)**: 텍스트 패턴을 Grok 파서로 파싱해 `trace_id` 예약 속성으로 remap.

## 비용 레버 (최소비용)

- dev 1 호스트. `DD_CONTAINER_EXCLUDE` 로 OSS 관측 컨테이너 수집 제외(이중 과금 방지).
- `DD_TRACE_SAMPLE_RATE=0.2`(dev 저부하). 안 볼 땐 `down`.
- OpenMetrics 는 `.*` 대신 큐레이트된 메트릭만(커스텀 메트릭 timeseries 과금).

## 다음 (Phase 3 — 별도 결정)

만족 시 cd.yml 상시 내장으로 승격 + Prometheus/Grafana/Loki 스택 폐기(`ops-monitor.dev.yml` down).
