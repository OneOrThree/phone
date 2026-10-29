# 실행 중인 로그 수집 경로와 버퍼 용량 조사 (GROMO-2554)

> 2026-10-29 작성. 구현 계획의 [P0 항목](implementation-plan.md#3-p0에서-반드시-확인할-항목)과 [버퍼 공식](implementation-plan.md#4-데이터-신뢰성과-용량-설계)을 실제 값으로 채운 조사표다. 설계 자체는 [아키텍처](README.md)를 따른다.

**읽는 법.** 값마다 근거 등급을 붙인다.

| 등급 | 뜻 |
| --- | --- |
| 실측 | 이 조사에서 실행 중인 시스템에서 직접 읽은 값(시각 표기) |
| 설정상 | 저장소의 설정 파일에 적힌 값. 실제 기동 상태와 같다는 보장이 없다 |
| 미확인 | 접근 불가 또는 조회하지 않음. 해당 항목에 의존하는 배포는 보류한다 |

저장소 파일 경로는 `server/scripts/`, `.github/workflows/`, `docs/prd/` 기준이며 줄 번호는 이 브랜치 기준이다. 시크릿 값, API 키, 계정 ID 전체는 적지 않는다.

## 1. 조사 범위와 접근 상태

| 대상 | 접근 | 결과 |
| --- | --- | --- |
| dev VM (`gromo-dev-app`, GCP 프로젝트 `oneorthree2`) | 읽기 전용 SSH, 2026-10-29T03:33Z~03:34Z | 실측 |
| Datadog (us5 사이트) | 읽기 전용 MCP 조회, 2026-10-29T03:39Z 전후 | 실측(§3) |
| prod EC2 | 접속하지 않음 | 설정상 또는 미확인 |
| AWS (S3, IAM) | SSO 토큰 만료로 CLI 사용 불가 | 미확인(§6) |

## 2. dev 실측 (2026-10-29T03:33Z)

원본: 읽기 전용 조사 스크립트(`docker inspect`·`df`·`systemctl list-timers`·로그 파일 60초 크기 변화, env는 `DD_*` 등 허용 목록만 출력)의 결과다. 시크릿이 섞일 수 있어 원본 출력은 저장소에 넣지 않는다.

### 2.1 호스트

| 항목 | 값 | 등급 |
| --- | --- | --- |
| 머신 | e2-standard-2, 2 vCPU, 메모리 7.9 GB(available 2.7 GB), swap 394 MB 사용 | 실측 |
| 디스크 `/` | 49 GB 중 사용 31 GB, **여유 18 GB (65% 사용)** | 실측. `65%`는 `df` 표기(반올림)이며 31/49로 계산하면 63%다 |
| Docker | 29.7.2, 기본 log driver `json-file` 10m x 3 (`daemon.json`) | 실측 |
| `/var/lib/docker/containers` 합계 | 76 MB | 실측 |
| journald | 활성+보관 합계 1.7 GB | 실측 |
| Nginx | 1.18.0, 호스트 systemd `active`, 컨테이너 아님 | 실측 |
| Nginx 로그 | `/var/log/nginx/access.log`·`error.log`, 기본 combined 형식, `request_id` 없음, logrotate daily·rotate 14·compress | 실측 |
| S3 업로더 | systemd timer·cron 없음(`aws` CLI만 설치). `logrotate.timer`·`google-oslogin-cache.timer`만 존재 | 실측 |
| Fluent Bit | 설치·컨테이너 없음 | 실측 |

### 2.2 컨테이너와 이미지

| 컨테이너 | 이미지 식별(앞 12자 digest 또는 태그) | Docker log 옵션 | `DD_SERVICE` | `DD_TRACE_SAMPLE_RATE` | `DD_VERSION` |
| --- | --- | --- | --- | --- | --- |
| phone-data-api | data-api@sha256:ad29002ea4b6 | 50m x 4 | gromo-data-dev | **0.2** | 이미지 digest 문자열 |
| phone-realtime | realtime@sha256:3828fbd6763d | 50m x 4 | gromo-realtime-dev | 1.0 | af74aa5ccd3a (커밋) |
| phone-business-api-1 | business-api@sha256:ef70223bb18f | 50m x 4 | gromo-business-dev | 1.0 | a428ed11d979 (커밋) |
| phone-notification-1 | notification@sha256:41cd527b7fdc | 50m x 4 | gromo-notification-dev | 1.0 | a428ed11d979 (커밋) |
| gromo-datadog-agent | gcr.io/datadoghq/agent:7 (agent 7.82.1) | 10m x 3 | - | - | - |
| phone-db / phone-redis / phone-business-redis-1 | postgres:16.14-alpine / redis:7.4.11-alpine x2 | 10m x 3 | - | - | - |
| gromo-grafana / gromo-prometheus | grafana:11.4.0 / prometheus:v2.55.1 | 10m x 3 | - | - | - |
| phone-kafka 외 exporter 2 | apache/kafka:3.8.1 외 | 10m x 3 | - | - | - |

- 이미지는 모두 amd64다. 전체 digest는 위 조사 원본에 있다. `DD_VERSION`이 서비스마다 digest·커밋으로 다른 점은 후속 표기 통일 후보다.
- Data만 sample rate 0.2이다. sampling 때문에 Data의 `trace_id`는 APM에서 조회되지 않는 요청이 80%일 수 있다(V13 관련).
- **Loki·Promtail 컨테이너는 떠 있지 않다.** overlay 정의(`server/scripts/docker-compose.observability.yml`, `server/observability/loki/loki-config.yml`)는 있으나 실행 중인 것은 grafana·prometheus·exporter뿐이다. 2555의 dev Loki 검증은 로컬 Docker 또는 `ops-monitor.dev.yml` 기동이 먼저 필요하다.

### 2.3 Datadog agent와 tracer

| 항목 | 값 | 등급 |
| --- | --- | --- |
| agent | 7.82.1, Logs Agent `LogsProcessed 1803`·`LogsSent 1935`, APM receiver 0.0.0.0:8126 | 실측 |
| tracer | 직전 1분 보고 5건 모두 java 17.0.20.1, dd-trace-java **1.64.0** | 실측 |
| 로그 수집 | `DD_LOGS_ENABLED=true`, `DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true` — **전 컨테이너 stdout을 이미 Datadog Logs로 전송 중** | 실측 |
| `DD_LOGS_INJECTION` | 4개 앱 모두 `true` | 실측 |
| `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED` | 4개 앱 모두 **미설정**. 1.64.0 기본값은 이 조사에서 확인하지 않았다 | 미확인 |
| 로그 제외 | 저장소 설정은 관측 스택 일부(loki, promtail 등)를 로그 수집에서 제외 | 설정상: `server/scripts/docker-compose.datadog.yml:40` |

새 수집기(Fluent Bit)를 붙이면 같은 컨테이너 stdout이 Datadog Logs와 새 경로로 이중 적재된다. 유지·제외 여부는 결정 대기이며 이 문서가 정하지 않는다.

### 2.4 로그 생산량 60초 샘플

| 컨테이너 | 60초 증가 bytes | bytes/sec |
| --- | --- | --- |
| phone-business-api-1 | 16,260 | 271.0 |
| phone-data-api | 209 | 3.5 |
| gromo-grafana / gromo-kafka-exporter | 1,868 / 2,308 | 31.1 / 38.5 |
| realtime, notification, db, redis 등 나머지 | 0 | 0 |

이 샘플은 새벽 시간대 60초이며 peak를 대표하지 않는다. 용량 계산의 peak는 §3의 Datadog 7일 값을 쓴다.

## 3. Datadog 읽기 전용 조회

조회 도구: Datadog MCP `execute_code`(`v2.MetricsApi.queryTimeseriesData`), `aggregate_spans`, `get_datadog_metric`. 쓰기 호출 없음. 조회 종료 시각 2026-10-29T03:39:00Z, 구간 최근 7일(APM은 24시간).

### 3.1 로그 수집량

쿼리(1분·5분 해상도 각각 `interval=60000`, `300000`):

```text
sum:datadog.estimated_usage.logs.ingested_bytes{*} by {service,env}.as_count()
sum:datadog.estimated_usage.logs.ingested_events{*} by {service,env}.as_count()
```

한계: 이 지표의 `env` 태그가 모든 시리즈에서 `N/A`이므로 환경은 `service` 이름(`*-dev`, `*-prod`)으로 구분했다. 지표는 Datadog이 **받은** 로그 크기이며 Docker `json-file` 원본 크기와 같지 않다. 로그가 없는 분에는 점이 없어(null) 표의 평균은 «점이 있는 구간 평균»이므로 실제 평균은 7일 합계를 604,800초로 나눈다.

| 서비스 | 7일 합계(B) | 7일 평균(B/s) | 1분 최대(B) | 1분 p95(B) | 5분 최대(B) | 5분 p95(B) | 1분 최대 이벤트 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| catus-realtime-prod | 254,414,800 | 420.7 | 12,796,088 | 33,319 | 41,919,477 | 214,954 | 799 |
| catus-business-api-prod | 113,505,205 | 187.7 | 11,545,404 | 1,183,046 | 15,980,608 | 2,933,455 | 9,759 |
| catus-data-api-prod | 71,133,113 | 117.6 | 1,819,416 | 10,106 | 6,056,075 | 72,863 | 1,618 |
| gromo-nginx-prod | 6,960,964 | 11.5 | 76,722 | 31,926 | 99,372 | 48,582 | 151 |
| catus-kafka-prod | 725,099 | 1.2 | 23,194 | 21,403 | 112,535 | 4,283 | 27 |
| gromo-back-prod (1.x) | 3,319,498 | 5.5 | 11,510 | 2,408 | 11,510 | 3,504 | 10 |
| gromo-data-dev | 2,743,678 | 4.5 | 225,528 | 4,733 | 226,782 | 31,442 | 153 |
| gromo-business-dev | 79,805,688 | 131.9 | 135,912 | 10,453 | 238,145 | 67,369 | 117 |
| gromo-realtime-dev | 2,736,101 | 4.5 | 95,765 | 14,333 | 97,633 | 94,427 | 77 |
| gromo-notification-dev | 3,956,526 | 6.5 | 83,893 | 58,086 | 89,435 | 85,631 | 65 |
| gromo-kafka-dev | 121,510,776 | 200.9 | 227,500 | 12,728 | 279,227 | 62,324 | 302 |
| gromo-db-dev | 3,566,961 | 5.9 | 90,826 | 1,668 | 181,419 | 1,669 | 6 |
| gromo-back-dev (옛 이름) | 18,790,802 | 31.1 | 226,503 | 134,752 | 269,997 | 163,680 | 151 |
| nginx (env 불명, 호스트 불명) | 94,161,792 | 155.7 | 6,927,666 | 31,548 | 9,742,398 | 42,883 | 9,662 |

관찰:

- 평균은 매우 작지만(prod 합계 약 739 B/s) peak가 평균의 수백 배다. `catus-realtime-prod`와 `catus-business-api-prod`가 1분에 11~13 MB를 낸 구간이 있다. 같은 분의 이벤트 수가 799·9,759건으로 크지 않은 구간이 있어 한 줄 크기 또는 stack trace 폭주 가능성이 있다(같은 분인지는 확인하지 않았다 — 추정).
- 서비스 `nginx`(env 태그 없음)는 7일 합계 94 MB, 1분 최대 6.9 MB이다. dev 호스트 Nginx 파일은 하루 약 0.4 MB(§5.1 미확인 용량 소스)라 7일 94 MB와 맞지 않는다. 따라서 이 시리즈는 dev 호스트 파일이 아니라 prod(Catus) 컨테이너 Nginx일 가능성이 높다(추정). 판정은 미확인으로 두되 보수적 산정에서는 prod 합에 포함한다(§5.2). prod에 `gromo-nginx-prod`와 env 없는 `nginx`가 함께 있다는 사실은 prod 실행 구성이 1.x compose와 다를 수 있다는 단서이기도 하다(§4).
- `catus-notification-prod`는 로그 지표 시리즈가 없다. APM span은 있다(§3.2). 지표가 없는 이유는 확인하지 않았다 — 미확인. 다른 서비스명의 시리즈로 섞였을 가능성(예: env 없는 `nginx`)도 배제하지 않는다.
- 조회한 시리즈에 `env:prod`/`env:dev` 값은 없다. 환경별 로그량을 서비스명 규칙에 의존하므로 2555의 서비스명 매핑(`OBS_SERVICE`)과 맞춰야 한다.

### 3.2 APM

쿼리: `aggregate_spans`, `query=env:prod OR env:dev`, 최근 24시간, `group_by=service,env`. 라이브러리 버전 필드(`@_dd.library_version`, `@language`)로 묶는 시도는 **버킷이 비어 실패**(매칭 span 341,666건, 필드 부재) — prod tracer 버전은 이 조사에서 확인하지 못했다.

| 서비스 | env | 24h span 수 |
| --- | --- | --- |
| catus-data-api-prod | prod | 275,384 |
| catus-realtime-prod | prod | 44,795 |
| catus-business-api-prod | prod | 11,319 |
| catus-notification-prod | prod | 10,180 |
| gromo-back-prod (1.x) | prod | 22,566 |
| gromo-app | prod | 215 |
| gromo-notification-dev | dev | 159,536 |
| gromo-data-dev | dev | 136,778 |
| gromo-realtime-dev | dev | 19,914 |
| gromo-business-dev | dev | 9,827 |
| gromo-app-v2 | dev | 347 |

- prod 네 서비스에서 **tracer가 실제로 span을 보고한다(실측)**. sampling 값은 prod 쪽 실제 컨테이너 env를 보지 못해 미확인이다. 1.x 앱 compose는 `DD_TRACE_SAMPLE_RATE=0.2`로 설정돼 있다(설정상: `server/scripts/docker-compose.prod.yml:38`).
- `datadog.estimated_usage.apm.ingested_spans`(24h 평균 스칼라, 집계 단위 불명확)도 조회했으나 sampling 판정에는 쓰지 않았다.

## 4. prod 저장소 설정(설정상 값)

**먼저 알아둘 점.** `server/scripts/docker-compose.prod.yml`은 단일 앱(`gromo-app`, `DD_SERVICE=gromo-back-prod`) 구성이다. 문서 `docs/prd/fishcat/server-separation/deployment.md:78`은 Catus 2.0 운영 실행 구성·nginx·SSM 배포 문서가 별도 Infra 저장소(`prod/catus/runtime`)에서 관리된다고 한다. 따라서 아래 값이 현재 Catus 운영 컨테이너 설정과 같은지는 **확인되지 않았다**(§3의 Datadog 서비스명 `catus-*-prod`가 이를 뒷받침하고, `deployment.md:93`도 prod 컨테이너를 9개로 적어 단일 앱 1.x compose와 구성이 다르다). prod에 1.x compose의 `gromo-nginx-prod`와 env 없는 `nginx`가 함께 관측되는 점(§3.1)도 같은 방향의 단서다. 아래 표는 «출처» 열로 근거를 나눈다. **1.x compose** 행은 Gromo 1.x 구성의 설정상 값이라 Catus 적용 여부가 미확인이다. **Catus 워크플로**·**Catus Dockerfile** 행은 Catus 2.0 쪽 저장소 사실이고, **호스트 업로더 기록** 행은 `server/scripts/README.md`의 기록이다. 어느 행도 실제 기동 상태의 실측은 아니다.

| 항목 | 출처 | 설정상 값 | 근거 |
| --- | --- | --- | --- |
| 앱 이미지 | Catus 워크플로 | ECR 저장소 `catus-prod/<service>`, `linux/arm64`, 릴리스에 digest 조합 기록 | `.github/workflows/prod-ci.yml:152,171-172`, `deployment.md:100-101` |
| 실행 구성 고정 | Catus 워크플로 | `CATUS_PROD_INFRA_REVISION` 40자리 SHA, S3 `configurations/<SHA>/configuration.zip` 검증 | `prod-ci.yml:70,93`, `deployment.md:78` |
| 배포 방식 | Catus 워크플로 | `prod-cd.yml`, SSM 전송 | `.github/workflows/prod-cd.yml:55-80` |
| DD agent | 1.x compose | `gcr.io/datadoghq/agent:7`(태그 고정 아님), `DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true`, `DD_LOGS_CONFIG_DOCKER_CONTAINER_USE_FILE=true`, APM 활성 | `docker-compose.prod.yml:88,104,108,112` |
| 로그 오프셋 | 1.x compose | named volume `datadog_agent_run` | `docker-compose.prod.yml:121` |
| tracer | Catus Dockerfile | dd-java-agent 1.64.0 jar를 각 Dockerfile이 포함 | `server/data-api/Dockerfile:43`, `server/business-api/Dockerfile:40`, `server/notification/Dockerfile:41`, `server/realtime/Dockerfile:41` |
| `DD_ENV`, `DD_TRACE_SAMPLE_RATE` | 1.x compose | prod, 0.2 | `docker-compose.prod.yml:35,38` |
| `DD_LOGS_INJECTION` | 1.x compose | true | `docker-compose.prod.yml:41` |
| Docker log 옵션 | 1.x compose | 앱·nginx `50m x 4`, 인프라 `10m x 3` | `docker-compose.prod.yml:14-19`, `server/scripts/README.md:140-141` |
| Nginx | 1.x compose | **컨테이너** `nginx:1.28-alpine`(`gromo-nginx`), 서비스 태그 `gromo-nginx-prod` | `docker-compose.prod.yml:58-77` |
| 앱 파일 로그 | 1.x compose | 호스트 `/var/log/springboot`를 `/app/logs`에 바인드(`app.log`, `user-activity.log`) | `docker-compose.prod.yml:46-49` |
| S3 업로더 | 호스트 업로더 기록 | 호스트 systemd 타이머, 매시간, 티켓 590. `user-activity/` 접두는 Fluent Bit 전환 예정(790, 미완) | `server/scripts/README.md:250-254` |
| 업로더 중복 | 호스트 업로더 기록 | 2288(새 prod·호스트 업로더)과 위 590 타이머의 공존 여부 미확인 | `implementation-status.md` 2288 기재 |
| lifecycle 규칙(기록) | 호스트 업로더 기록 | `system_log/`·`user_log/`·`user-activity/` 각 90일, 불완전 multipart 1일 | `server/scripts/s3-log-archive-lifecycle.json:1-24` |
| 컷오버 | Catus 문서(`deployment.md`) | 2026-10-14 Catus 전환 완료, 로그 아카이브 확인 문구가 있으나 세부는 Infra 문서에 있음 | `deployment.md:93` |

저장소에 적힌 «적용 완료 2026-09-19»와 «Terraform 원본과 어긋남(GROMO-1948)»(`server/scripts/README.md:258-260`)은 **과거 기록**이다. 구현 계획 P0 5번대로 실측을 대신하지 않는다. 버킷 이름은 12자리 계정 ID를 포함하므로 이 문서에서는 `gromo-prod-logs-<ACCOUNT_ID>`로 쓴다(실제 이름은 운영 문서에 있다).

## 5. 용량 계산

공식은 [구현 계획 §4](implementation-plan.md#4-데이터-신뢰성과-용량-설계)를 따른다.

```text
필요 버퍼 = peak bytes/sec x 견딜 중단 시간(sec) x 여유 계수
```

### 5.1 입력

| 입력 | 값 | 근거 |
| --- | --- | --- |
| 견딜 중단 시간 | 1,800초(30분) | 구현 계획 P0의 초기 시험 조건 |
| 여유 계수 | 2 | 추정. 근거: (a) Datadog 지표는 수신 크기라 Docker 원본·JSON 변환 후 크기와 다르다 (b) parser가 필드를 붙여 줄 크기가 커질 수 있다 (c) 측정 한계(최대 줄 크기·미확인 소스 미반영). 실측 후 조정한다. (a)~(c)는 서로 독립이며 서비스별 peak를 겹쳐 합산한 보수성과도 별개다 |
| peak 기준 | **알려진 소스 기준** Datadog 1분 최대 합. 같은 분에 동시에 발생한다고 가정한 값이며, 미확인 소스(아래 «미확인 용량 소스»)는 제외했으므로 **상한이 아니다** | §3.1 |
| 합산 기준 | 앱 4개 + Nginx는 수집 대상으로 확정이고, 인프라(kafka·db)는 수집 여부가 2556 이후 결정이라 보수적으로 포함한다 | §3.1 |
| prod 합산 대상 | catus-realtime, business-api, data-api, kafka, gromo-nginx-prod, `nginx`(env 불명 — prod 컨테이너 Nginx일 가능성이 높아(추정, §3.1) 포함). 1.x `gromo-back-prod`(가동 중, 1분 최대 11,510 B)는 허용 목록 4개 앱(2555)에 없어 제외하고, 1.x `gromo-nginx-prod`는 Nginx 입력(2556) 대상일 수 있어 포함한다 | §3.1 |
| dev 합산 대상(**전체 컨테이너 합**) | gromo-data/business/realtime/notification, kafka, db. 인프라(kafka, db)를 포함하므로 수집 대상 합보다 크다. `gromo-back-dev`(옛 이름)는 현재 컨테이너 목록(§2.2)에 없어 합에서 뺐다(7일 안에 사라졌는지는 미확인, §9). 호스트 Nginx는 컨테이너가 아니어서 Datadog 컨테이너 수치에 없고 합에 **들어 있지 않다** | §3.1 |
| 한 줄 최대 크기 | 측정하지 않음 | 미확인 |
| 미확인 용량 소스 | 아래 표 | 합산 제외 |

미확인 용량 소스(생산량을 모르는 수집 대상). 이 값이 확인되기 전까지 §5.2~§5.5의 버퍼는 **알려진 소스 기준 값**이다(dev·prod 용어 동일).

| 소스 | 환경 | 확인된 것 | 미확인 |
| --- | --- | --- | --- |
| 호스트 Nginx 파일 `/var/log/nginx` | dev | 실측(2026-10-29T03:33Z, `ls -la`): `access.log` 94,119 B(00:00~03:34 UTC, 약 3.6시간), `access.log.1` 428,726 B(10-28 하루), 압축본 `access.log.2.gz`~`.14.gz` 26~88 KB, `error.log` 527 B, `error.log.1` 2,838 B. 하루 평균 약 5 B/s | **분 단위 peak 미측정** → dev 버퍼는 알려진 소스 기준 값 |
| catus-notification-prod | prod | 로그 지표 시리즈 없음. APM span 24h 10,180건(§3.2) | 로그 생산량 미확인 → prod 버퍼는 알려진 소스 기준 값 |

dev 60초 샘플(합 약 345 B/s)은 peak 근거로 쓰지 않는다. DD 7일 값을 우선한다.

### 5.2 peak 계산

| | 1분 최대 합(B/min) | peak(B/s) | 비교: 5분 최대 합(B/s) | 비교: 7일 평균(B/s) |
| --- | --- | --- | --- | --- |
| prod (알려진 소스 + `nginx`) | 26,260,824 + 6,927,666 = 33,188,490 | **553,142** | 213,894(`nginx` 제외) | 739(`nginx` 제외) |
| dev (전체 컨테이너 합, `gromo-back-dev` 제외) | 859,424 | **14,324** | 3,709 | 354 |

계산(python): `round((26260824+6927666)/60) = 553142`, dev `d=225528+135912+95765+83893+227500+90826 = 859424`, `round(d/60) = 14324`. 비교 열: dev 5분 최대 합 `(226782+238145+97633+89435+279227+181419)/300 = 3709`, dev 7일 평균 합 `(2743678+79805688+2736101+3956526+121510776+3566961)/604800 = 354`.

peak는 **알려진 소스의 1분 최대 합**이다(같은 분 동시 발생 가정). 아래 소스는 제외돼 있어 상한이 아니다.

이 peak는 «1분 최대를 30분 내내 지속»한다고 가정해 5분 최대보다 prod 2.6배(553,142 / 213,894), dev 3.9배(14,324 / 3,709) 크다. «상한 아님»(미확인 소스 제외)과 «보수적»(지속 가정)은 서로 다른 방향의 한계이며 둘 다 맞다.

- prod: catus-notification-prod 생산량 미확인.
- dev: 호스트 Nginx 일 평균 약 5 B/s(실측), peak 미측정(미확인). 「일 평균 × 가정 배수」 같은 추정치는 쓰지 않는다.

### 5.3 버퍼와 store_dir

`storage.total_limit_size`(engine 디스크 버퍼)와 S3 output의 `store_dir_limit_size`는 역할이 달라 각각 산정한다([조사 기록](research.md)). 같은 데이터가 두 곳에 동시에 있을 수 있어(engine이 가득 찬 상태에서 S3 업로드도 막히면 둘 다 최대로 찰 수 있다) 디스크 합계에는 각각 최대로 잡아 모두 더한다. 보수적 선택이다.

| | 계산 | prod | dev |
| --- | --- | --- | --- |
| engine buffer (`storage.total_limit_size`) | peak x 1,800 x 2 | 553,142 x 3,600 = 1,991,311,200 B = **1.99 GB** | 14,324 x 3,600 = 51,566,400 B = **52 MB** |
| S3 `store_dir_limit_size` | peak x 1,800 x 2 (S3만 30분 중단 가정) | **1.99 GB** | **52 MB** |
| 30분 중단 순수 적체(여유 계수 1) | peak x 1,800 | 995,655,600 B = 995.7 MB | 25,783,200 B = 25.8 MB |

위 값은 모두 **알려진 소스 기준**이다. prod는 catus-notification-prod 미확인 때문에 상한이 아니고, dev도 호스트 Nginx peak 미측정 때문에 상한이 아니다. 두 소스를 측정하기 전에는 버퍼 크기를 확정하지 않는다.

`store_dir`을 gzip 전 크기로 잡았다(추정, 압축 상태 미확인). 한 번에 업로드하는 청크 크기와 `timeout`에 따른 임시 파일은 Fluent Bit 버전·설정 확정 후 더한다.

### 5.4 호스트 디스크 합계

필요 디스크 = Docker 회전본 상한 + engine buffer + store_dir + 임시 + 운영 여유.

| 항목 | dev | prod |
| --- | --- | --- |
| Docker 회전본 상한 | 앱 4개 x 200 MB + 인프라 9개 x 30 MB(§2.2: agent 1, db·redis 3, grafana·prometheus 2, kafka·exporter 3) = **1.07 GB** (현재 사용 76 MB) | 앱 4 + nginx x 200 MB + 인프라 N x 30 MB. 1.x의 50m x 4를 4개 서비스에 그대로 적용한 **설정상 추정**이다(Catus 실제 log 옵션 미확인). N 미확인 → 최소 **1.0 GB + 30 MB x N** |
| engine buffer | 52 MB(알려진 소스 기준) | 1.99 GB(알려진 소스 기준) |
| store_dir | 52 MB(알려진 소스 기준) | 1.99 GB(알려진 소스 기준) |
| 임시 파일 | 100 MB(추정) | 500 MB(추정) |
| 소계(운영 여유 제외) | 약 **1.27 GB** | 약 **5.5 GB + 30 MB x N** |
| 디스크 크기·여유 | 49 GB, 여유 18 GB(실측) | **미확인**(차단 조건) |
| 판정 | 여유 18 GB 대비 7.1%(1,274 MB / 18,000 MB) — 충분 | 디스크 크기 확인 전 판정 불가 |

### 5.5 경보 임계값 후보

| 경보 | 임계 | dev 대입 | prod 대입 |
| --- | --- | --- | --- |
| 가용 디스크 20% 이하 | 총 용량의 20% | 49 GB x 0.2 = **9.8 GB**. 현재 여유 18 GB(36.7%)는 위쪽이며 임계까지 여유 8.2 GB | 총 용량 미확인 |
| engine buffer 80% 이상 | 0.8 x total_limit_size | 41 MB(41,253,120 B) | 1.59 GB(1,593,048,960 B) |
| S3 store_dir 80% 이상 | 0.8 x store_dir_limit_size | 41 MB(41,253,120 B) | 1.59 GB(1,593,048,960 B) |

경보 임계도 알려진 소스 기준 버퍼에서 나온 값이다. 미확인 소스 측정 후 다시 계산한다.

dev는 현재 여유 18 GB가 임계 9.8 GB보다 높지만, Docker 회전본이 상한까지 차고(1.07 GB) journald 1.7 GB가 늘면 여유가 줄 수 있다. swap 사용과 메모리 available 2.7 GB 상태에서 Fluent Bit과 Loki를 동시에 올릴 때의 메모리는 이 조사에서 계산하지 않았다(P0 6번, 미확인).

## 6. S3·IAM·암호화 확인 (미확인, 배포 차단)

AWS 접근 불가로 아래는 모두 **미확인**이다. 하나라도 확인되지 않으면 S3 포함 배포(P2)를 하지 않는다.

| 항목 | 상태 | 차단 조건 | 확인 방법(읽기 전용) |
| --- | --- | --- | --- |
| 버킷 이름·리전 | 설정상(저장소에 이름 있음) | 실제 존재·리전 불일치 | `aws s3api head-bucket` |
| lifecycle 실제 적용 | 설정상(JSON 파일 + «적용 완료» 기록). Terraform 원본과 어긋났다는 과거 기록 있음 | 접두 3개 규칙 90일·`AbortIncompleteMultipartUpload` 1일이 실제 버킷에 없음. `system_log/v2/` 접두가 규칙 범위 | `get-bucket-lifecycle-configuration` |
| 암호화 | 미확인 | 기본 암호화 미설정 | `get-bucket-encryption` |
| versioning | 미확인 | 켜져 있으면 비현재 버전 만료 규칙 필요 | `get-bucket-versioning` |
| 불완전 multipart | 미확인 | 오래된 업로드 잔존 | `list-multipart-uploads` |
| Fluent Bit 쓰기 IAM | 미확인 | `system_log/v2/` 최소 권한 + 타 환경 쓰기 차단 + 삭제 불가 확인 불가 | (A) 역할 identity policy 시뮬레이션 + (B) 버킷 정책 검토(아래, 둘을 결합하지 않는다) |
| dev -> S3 자격 방식 | 미결정 | dev에 AWS 자격 경로 없음(aws CLI만 설치) | 결정 필요 |
| 롤백 소유자 | 미확인 | S3 설정·업로더 롤백 담당 미지정 | 담당 확인 |
| 업로더 중복(590 timer / 2288) | 미확인 | 이중 적재로 중복 | prod 호스트 `systemctl list-timers` |

운영 책임자가 `aws sso login` 후 실행할 읽기 전용 명령(버킷 이름은 운영 문서의 값으로 바꾼다). 결과를 남길 때 **조회 시각(UTC)** 을 함께 적는다. Terraform apply로 lifecycle 등이 조회 뒤에 바뀔 수 있다.

```bash
B=gromo-prod-logs-<ACCOUNT_ID>
aws --profile gromo s3api head-bucket --bucket "$B"
aws --profile gromo s3api get-bucket-location --bucket "$B"
aws --profile gromo s3api get-bucket-lifecycle-configuration --bucket "$B"
aws --profile gromo s3api get-bucket-encryption --bucket "$B"
aws --profile gromo s3api get-bucket-versioning --bucket "$B"
aws --profile gromo s3api get-public-access-block --bucket "$B"
aws --profile gromo s3api get-bucket-policy --bucket "$B"
aws --profile gromo s3api list-multipart-uploads --bucket "$B" --max-uploads 100
aws --profile gromo s3api list-objects-v2 --bucket "$B" --prefix system_log/ --max-items 5
```

설정이 없으면 `NoSuchLifecycleConfiguration`, `NoSuchBucketPolicy`, `ServerSideEncryptionConfigurationNotFoundError` 같은 오류로 끝난다. 이 오류도 «없음»이라는 판정 결과이므로 오류 응답 그대로 기록한다. 단 `AccessDenied` 는 «없음»이 아니라 **판정 불가**다. 운영자 쪽에도 `iam:SimulatePrincipalPolicy`·`iam:GetRole`·`kms:GetKeyPolicy`·`kms:ListGrants` 등 읽기 권한과 `ec2:DescribeInstances` 가 필요하므로, 권한 부족 오류를 «없음»으로 적지 않는다.

**대상 역할 찾기.** 역할 이름을 추측(`log`·`fluent` 포함 여부)하지 않는다. 아래 순서로 실제 사용 중인 역할을 먼저 찾는다.

1. 현재 호스트가 쓰는 역할: `aws ec2 describe-instances --instance-ids <ID>`의 `IamInstanceProfile` -> `aws iam get-instance-profile --instance-profile-name <NAME>`의 `Roles[].RoleName`.
2. 590 업로더가 쓰는 역할(호스트 타이머가 쓰는 자격): 위 1과 같은 경로 또는 운영 문서 기록.
3. **Fluent Bit 전용 신규 역할은 아직 없을 수 있다.** 없으면 위 1·2는 «현재 권한 조사»이고, 신규 역할은 아래 합격 기준을 **설계 검토 기준**으로 삼아 생성 전에 정책안에 적용한다. 둘을 같은 결과로 섞어 기록하지 않는다.

```bash
R=<ROLE_NAME>
aws --profile gromo iam get-role --role-name "$R"        # PermissionsBoundary 확인
aws --profile gromo iam list-attached-role-policies --role-name "$R"
aws --profile gromo iam list-role-policies --role-name "$R"

# 관리형 정책: 위 결과의 각 PolicyArn 마다 기본 버전 본문을 읽는다
P=<POLICY_ARN>
V=$(aws --profile gromo iam get-policy --policy-arn "$P" --query Policy.DefaultVersionId --output text)
aws --profile gromo iam get-policy-version --policy-arn "$P" --version-id "$V"

# 인라인 정책: list-role-policies 가 돌려준 각 이름마다
aws --profile gromo iam get-role-policy --role-name "$R" --policy-name <POLICY_NAME>

# 판정 (A): 역할 identity policy(권한 경계 포함)만 시뮬레이션한다. --resource-policy 는 쓰지 않는다.
# AWS CLI 문서: "Simulation of resource-based policies isn't supported for IAM roles."
# (https://docs.aws.amazon.com/cli/latest/reference/iam/simulate-principal-policy.html, --resource-policy 항목)
# 버킷 정책은 아래 (B)에서 사람이 읽는다. 버킷 정책의 조건 키도 (B)에서 확인한다.
# 먼저 이 역할 정책이 참조하는 조건 키를 읽어 --context-entries 에 채울 값을 정한다(읽기 전용).
ARN=$(aws --profile gromo iam get-role --role-name "$R" --query Role.Arn --output text)
aws --profile gromo iam get-context-keys-for-principal-policy --policy-source-arn "$ARN"
# --action-names 와 --resource-arns 는 모든 조합으로 평가되므로, 리소스 유형(객체/버킷)이 맞는 묶음끼리 따로 호출한다.
OBJ="arn:aws:s3:::$B/system_log/v2"
# (1) 객체 ARN 호출: 허용 env 접두 안 / 다른 env= / 이웃 접두 아래 ARN 전부에 Put 과 Delete*·AbortMultipartUpload 를 넣는다
#   env=<허용 env 를 접두로 포함하는 값>: 허용 env 가 prod 면 env=prod2 (정책이 env=prod* 로 쓰인 경우만 잡힌다)
#   system_log/app-1 (590 업로더 경로), system_log/v2 (env 없이), user-activity/dt=2026-01-01
aws --profile gromo iam simulate-principal-policy --policy-source-arn "$ARN" \
  --action-names s3:PutObject s3:DeleteObject s3:DeleteObjectVersion s3:AbortMultipartUpload \
  --resource-arns "$OBJ/env=<허용 env>/x" "$OBJ/env=<다른 env>/x" "$OBJ/env=<허용 env를 접두로 포함하는 값>/x" \
    "$OBJ/x" "arn:aws:s3:::$B/system_log/app-1/x" "arn:aws:s3:::$B/user-activity/dt=2026-01-01/x" "arn:aws:s3:::$B/user_log/x" \
  --context-entries "ContextKeyName=aws:SecureTransport,ContextKeyValues=true,ContextKeyType=boolean" \
    "ContextKeyName=aws:RequestedRegion,ContextKeyValues=<버킷 리전>,ContextKeyType=string" \
    "ContextKeyName=s3:x-amz-server-side-encryption,ContextKeyValues=<정책이 요구하는 값>,ContextKeyType=string"
# (2) 버킷 ARN 호출: 버킷 수준 액션은 버킷 ARN 으로만
aws --profile gromo iam simulate-principal-policy --policy-source-arn "$ARN" \
  --action-names s3:PutLifecycleConfiguration s3:PutBucketPolicy s3:PutBucketVersioning s3:PutEncryptionConfiguration s3:DeleteBucket s3:ListBucketMultipartUploads \
  --resource-arns "arn:aws:s3:::$B"
# (3) SSE-KMS 버킷이면 버킷 키 ARN 과 «다른 키 ARN» 에 각각 넣는다. 다른 키 대표 선정: 다른 환경 로그 버킷의 키 1개 + 같은 계정·리전의 임의 고객 관리 키 1개(둘 다 시험)
aws --profile gromo iam simulate-principal-policy --policy-source-arn "$ARN" \
  --action-names kms:GenerateDataKey kms:Decrypt --resource-arns "<버킷 키 ARN>" "<다른 키 ARN>" \
  --context-entries "ContextKeyName=kms:ViaService,ContextKeyValues=s3.<버킷 리전>.amazonaws.com,ContextKeyType=string"
# (4) 키 정책·grant 는 시뮬레이터 밖이므로 대상 키마다 직접 읽는다(읽기 전용)
aws --profile gromo kms get-key-policy --key-id "<키 ARN>" --policy-name default
aws --profile gromo kms list-grants --key-id "<키 ARN>"
# 판정 (B): 버킷 정책 본문을 읽는다(시뮬레이션 아님). 정책이 없으면(NoSuchBucketPolicy) (B)는 «정책 없음»으로 기록한다.
aws --profile gromo s3api get-bucket-policy --bucket "$B" --query Policy --output text
```

**결과 기록 (A).** `EvaluationResults[]` 의 (액션, 리소스) 쌍마다 `EvalDecision`(`allowed`/`implicitDeny`/`explicitDeny`)을 한 줄씩 적는다. 출력의 `MissingContextValues` 도 같이 적는다. 정책에 `aws:SecureTransport`·`s3:x-amz-server-side-encryption`·`aws:RequestedRegion` 같은 Condition 이 있으면 `--context-entries` 로 채우지 않은 값은 «불일치»로 평가되어 허용이 `implicitDeny` 로, 조건부 Deny 가 적용되지 않은 채로 나올 수 있다. `MissingContextValues` 가 남아 있으면 값을 채워 다시 실행한다. 어떤 키를 채울지는 위 `get-context-keys-for-principal-policy` 결과(역할 정책 기준)로 정한다. 버킷 정책의 조건 키는 (B)에서 사람이 확인한다.

(A) 합격 방향은 항목마다 반대다. 쓰기 범위는 `allowed` 가 합격이고, 삭제·버킷 변경·타 환경 항목은 `allowed` 가 나오면 불합격이다.

| 판정 항목 | 합격 기준 |
| --- | --- |
| 쓰기 범위 | `s3:PutObject`가 `arn:aws:s3:::<bucket>/system_log/v2/env=<env>/*`에서 `allowed`(합격), 다른 접두에서는 아래 행. 버킷이 SSE-KMS 면 (3)의 버킷 키 `kms:GenerateDataKey`·`kms:Decrypt` 도 `allowed` 여야 한다 |
| 삭제·수명주기·버킷 변경 권한 부재 | `s3:DeleteObject`, `s3:DeleteObjectVersion`은 (1)의 객체 ARN 전부(허용 env 안 포함), `s3:PutLifecycleConfiguration`·`s3:PutBucketPolicy`·`s3:PutBucketVersioning`·`s3:PutEncryptionConfiguration`·`s3:DeleteBucket`은 버킷 ARN 에서 `implicitDeny` 또는 `explicitDeny`. 한 곳이라도 `allowed` 면 불합격 |
| 타 환경 쓰기 차단 | 다른 `env=` 접두(허용 env 를 접두로 포함하는 값 포함)와 `system_log/v2/` 밖(`system_log/app-1/`·env 없는 `system_log/v2/`·`user-activity/`·`user_log/`)에 대한 `s3:PutObject`가 `implicitDeny` 또는 `explicitDeny`. `allowed` 면 불합격 |
| 다른 KMS 키 차단 | (3)의 다른 키가 `implicitDeny` 또는 `explicitDeny` 이고, (4)로 읽은 그 키의 키 정책·grant 에 이 역할 ARN 이 직접 명시돼 있지 않아야 한다. 키 정책이 Condition 없는 IAM 위임(`arn:aws:iam::<ACCOUNT_ID>:root`)만 쓰는 경우에 한해 (3)의 `implicitDeny` 를 차단 근거로 인정한다. 그 밖이면 판정 불가로 기록 |
| 판정 불가 | (A)에서 `implicitDeny` 라도 `MissingContextValues` 가 비어 있지 않으면 합격으로 기록하지 않는다. 값을 채워 다시 실행한다 |

**결과 기록 (B): 버킷 정책 검토.** `get-bucket-policy` 본문을 Statement 하나씩 읽고 문장 단위로 판정한다. 이 판정은 (A)의 시뮬레이션과 «결합»한 결과가 아니다. IAM 역할에 대한 리소스 정책 시뮬레이션은 지원되지 않으므로(위 문서 인용) 두 결과를 따로 적고, 하나로 합쳐 합격 근거로 쓰지 않는다.

| 확인 항목 | 합격 기준(문장 단위) |
| --- | --- |
| 이 역할을 여는 `Allow` 의 범위 | Principal 이 이 역할 ARN, 역할이 속한 계정 `:root`, 또는 `*` 인 `Allow` 문장마다 Action·Resource·Condition 을 적는다. `system_log/v2/env=<env>/*` 쓰기 밖의 객체 ARN, `s3:Delete*`, 버킷 설정 변경(`s3:PutBucket*`·`s3:PutLifecycleConfiguration`·`s3:PutEncryptionConfiguration`·`s3:DeleteBucket*`)을 여는 문장이 하나라도 있으면 불합격 |
| `NotPrincipal`·`NotAction`·`NotResource` | 쓰인 문장이 있으면 실제로 열리는 범위를 풀어서 적고 위 행으로 판정한다. 풀 수 없으면 판정 불가 |
| 필요한 `Deny` | 타 env 접두 쓰기 차단 `Deny` 가 있는지 적는다. 없는 것이 불합격은 아니다(그 경우 차단은 (A)의 역할 정책 `implicitDeny` 에만 의존함을 기록). 있으면 Condition 을 적는다 |
| 허용 쓰기를 막는 `Deny` | 이 역할의 `system_log/v2/env=<env>/*` 쓰기(`s3:PutObject`·multipart 액션)를 거부하는 `Deny` 문장이 있는지 적는다. 있으면 그 Condition 을 실제 호출이 만족하는지 판단하고, 판단하지 못하면 판정 불가 |
| 조건 키 | 문장에 쓰인 Condition 키(`aws:SecureTransport`·`aws:SourceVpce`·`s3:x-amz-server-side-encryption` 등)를 모두 적는다. 역할 호출이 이 조건을 만족하는지 판단하지 못하면 판정 불가 |
| 정책 없음 | `NoSuchBucketPolicy` 이면 «버킷 정책 없음»으로 기록하고 (B)는 이 상태로 종료. 역할 쪽 평가는 (A)만 근거다 |

**최종 판정 규칙.** 쓰기 범위 제한·삭제 권한 부재·타 환경 쓰기 차단은 항목마다 **(A) 합격 그리고 (B) 합격**일 때만 합격이다. 어느 한쪽이 불합격이면 그 항목은 불합격, 판정 불가면 판정 불가다. 이것은 두 평가 결과를 합친 것이 아니라 각각의 판정을 함께 만족하라는 규칙이다. 예를 들어 (A)가 `implicitDeny` 로 삭제를 막아도 버킷 정책이 이 역할이나 `*` 에 `s3:Delete*` 를 `Allow` 로 열면(같은 계정에서는 한쪽 `Allow` 로 접근이 열린다) 삭제 권한 부재는 불합격이다.

**허용 예외(삭제 권한 부재 판정과 혼동하지 않는다).** Fluent Bit S3 플러그인은 multipart 업로드를 쓰므로 `s3:PutObject`만으로는 실패할 수 있다. 아래는 허용되어도 합격이다.

- `s3:AbortMultipartUpload`: 객체 접두(`system_log/v2/env=<env>/*`)로 제한된 경우.
- `s3:ListBucketMultipartUploads`: 필요한 경우에 한해 버킷 단위로만.
- 판정 방향은 쓰기 범위와 같다. (1)의 `s3:AbortMultipartUpload`는 허용 env 접두 안에서만 `allowed`이고 그 밖(다른 env·`system_log/app-1/`·`user_log/` 등)은 `implicitDeny` 또는 `explicitDeny`여야 한다. (2)의 `s3:ListBucketMultipartUploads`는 버킷 ARN 의 `allowed`만 허용 예외다.
- 버킷이 SSE-KMS(`get-bucket-encryption` 결과)이면 multipart 업로드에는 `kms:GenerateDataKey` 와 `kms:Decrypt` 가 둘 다 필요한 것으로 알려져 있다(AWS 문서 확인 필요). 두 액션은 해당 키 ARN 에 한해서만 허용돼야 하며, 위 (3) 호출에서 버킷 키는 `allowed`, 다른 키는 `implicitDeny` 또는 `explicitDeny` 인지 확인한다.

**시뮬레이션의 한계.** 역할에 대한 리소스 정책 시뮬레이션은 지원되지 않아, 역할 정책과 버킷 정책의 결합 평가는 이 절차로 얻을 수 없다. 결합 결과(교차 계정 접근에서 양쪽 허용이 모두 필요한 규칙, 같은 계정에서 버킷 정책의 `Allow` 가 역할 정책 없이도 통하는 경우, 어느 한쪽의 명시적 `Deny` 우선)는 (A)와 (B)를 사람이 읽고 AWS 평가 규칙(https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)을 적용해 판정한다. 합격 근거는 (A)·(B) 각각의 판정과 위 최종 판정 규칙이며, 결합 평가 결과는 만들지 않는다. 실제 호출 시험은 별도다. KMS 는 키 정책이 같은 계정의 역할을 직접 허용할 수 있어 역할 쪽 `implicitDeny` 만으로 «다른 키 차단»을 확정할 수 없고, 시뮬레이터는 키 정책을 평가하지 않는 것으로 알려져 있다(확인 필요). 그래서 (4)로 대상 키의 키 정책과 grant 를 직접 읽는다. 시뮬레이터는 `NotAction`/`NotResource` 를 정상 반영한다. 실제 한계는 SCP(조직 정책)가 평가에 포함되지 않는 점, 세션 정책, 그리고 실제 호출 시점의 컨텍스트와 입력한 컨텍스트의 차이다. 삭제·타 환경 항목에서 `allowed` 가 나오면 불합격이고 부여 경로를 추가 조사한다. 반대로 `implicitDeny` 가 나와도 SCP·세션 정책·컨텍스트 차이는 남으므로 실제 호출 시험은 별도다. dev 호스트의 사용자·그룹 경로 자격(`list-attached-user-policies` 등)은 dev -> S3 자격 방식 결정 뒤로 미룬다.

결과를 문서에 남길 때 계정 ID, 키, 정책 본문의 시크릿 값은 가린다(정책 본문은 Action·Resource 구조만 옮기고 계정 ID는 `<ACCOUNT_ID>`로 바꾼다). `list-objects-v2` 결과를 옮길 때는 객체 키에 사용자 값이 섞이지 않았는지 확인한다.

## 7. P0 10항목 판정

`확인`은 실측, `설정상`은 저장소 값, `미확인`은 차단 조건이다.

| # | 항목 | dev | prod |
| --- | --- | --- | --- |
| 1 | image digest·compose·JVM 옵션·agent·`DD_*` | **확인**: §2.2 digest, 4서비스 `DD_*`, tracer 1.64.0 | 설정상: §4. Catus 실제 컨테이너 env·digest는 **미확인**(Infra 소유). 차단: prod 컨테이너 env 확인 전 prod 활성화 보류 |
| 2 | 자동 계측(HTTP·executor·Kafka·JDBC) | 미확인: 이 조사에서 span 종류를 보지 않음 | 미확인 |
| 3 | 128-bit trace ID·`traceparent`·JSON 출력 | 미확인: `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED` 미설정, 1.64.0 기본값 미확인 | 미확인 |
| 4 | 서버별 bytes/sec·peak·최대 줄·예외·회전 | **부분 확인**: §3 DD 7일 peak, 최대 줄 크기 미측정 | **부분 확인**: §3 DD 7일. 호스트 Docker 로그 증가량·최대 줄 미확인 |
| 5 | S3 업로더·마지막 객체·lifecycle·versioning·암호화·IAM·multipart | **확인**: 업로더 없음 | 미확인(§6). 차단 |
| 6 | Loki·Datadog 실제 사용·보존·egress 비용·메모리 합계 | **확인**: Loki 미가동, Datadog 로그·APM 사용 중. 보존 기간·비용·메모리 합계 미확인 | **실측(Datadog 측 관측)**: `catus-*-prod` 로그·span 수신(§3). 보존·비용 미확인. `catus-*` 컨테이너의 수집 방식(`docker_container_collect_all`)은 설정상(§4) |
| 7 | canary·실험 로그의 별도 저장 위치·만료 | 미확인(미결정) | 미확인(미결정) |
| 8 | source inventory(경로·회전·권한·cursor·담당) | **확인**: 앱=Docker json-file, Nginx=호스트 파일 `/var/log/nginx`(logrotate 14일), 컨테이너 Nginx 없음. cursor·담당 미정 | 설정상: 앱=Docker json-file + 호스트 `/var/log/springboot` 파일, Nginx=컨테이너 stdout. DB 위치는 근거 없음 -> 미확인. 실제 경로·권한 미확인 |
| 9 | 아키텍처에 맞는 고정 Fluent Bit 이미지·plugin | amd64 필요(실측). 이미지·plugin 미선정 | arm64 필요(설정상: `prod-ci.yml:152`). 이미지·plugin 미선정 |
| 10 | 과대 로그·수용창·미래 시각·host clock·조회 상한 | 미확인: Loki는 미가동, `loki-config.yml`의 `auth_enabled: false`·`retention_period 168h`만 설정상 | 미확인 |

추가 확인 사항:

| 질문 | dev | prod |
| --- | --- | --- |
| Datadog Logs와 새 수집기의 이중 적재 | 현재 Datadog 단독 수집(실측). 새 경로 추가 시 이중 → **결정 대기** | 같은 구조(설정상). 결정 대기 |
| S3 업로더(timer/cron) | **없음**(실측) | 590 매시간 타이머(설정상), 2288 범위는 미확인 |
| Loki·Promtail 가동 | **미가동**(실측) | 해당 없음(overlay는 dev용) |

## 8. 배포 차단 조건 요약

1. AWS 읽기 전용 확인 미완료: lifecycle 적용, 암호화, versioning, multipart 정리, Fluent Bit 쓰기 IAM, 롤백 소유자(§6).
2. prod 호스트의 디스크 크기·여유, 실제 컨테이너 env·digest, 현재 업로더(590/2288) 상태.
3. dev -> S3 자격 방식 결정(자격 경로 없음).
4. Datadog Logs 유지·제외 결정(이중 적재·비용).
5. 128-bit trace ID 로그 출력의 실제 형식과 기본값 확인.
6. 최대 줄 크기와 peak 구간 원인(1분 11~13 MB 급증)의 확인. 버퍼 여유 계수 2는 이 확인 전까지 잠정값이다.
7. prod Notification과 dev 호스트 Nginx의 로그 생산량(peak 포함) 측정. 측정 전 버퍼는 알려진 소스 기준 값이다(§5.2).
8. dev에 Loki가 없으므로 2555 검증은 로컬 또는 `ops-monitor.dev.yml` 기동 후 진행.

## 9. 다음 확인 담당·시점

| 확인 | 담당 | 시점 |
| --- | --- | --- |
| §6 AWS 읽기 전용 명령 실행과 결과 기록 | 운영 책임자(`aws sso login` 필요) | 2556 착수 전, P2 배포 전 |
| prod 호스트 디스크·컨테이너 env·타이머 확인 | 운영 책임자 또는 Infra 담당(SSM) | P0 완료 전 |
| 128-bit trace ID 기본값, 대표 요청의 로그·span ID 일치 | 2555 구현 담당 | 2555 dev 검증 |
| peak 급증 구간의 원문 줄 크기 샘플(개인정보 없는 합성 재현) | 2555·2556 담당 | 수집기 부하 시험 전 |
| prod Notification·dev 호스트 Nginx 생산량(분 단위 peak) 측정 | 2554 후속(prod는 운영 책임자 또는 Infra 담당) | 버퍼 확정 전 |
| 여유 계수·버퍼 크기 재산정 | 2554 후속 | 위 실측 후 |
| `gromo-back-dev` 가 다른 호스트에서 아직 로그를 내는지(내면 dev peak 과소 산정) | 운영 책임자 또는 Infra 담당 | 버퍼 확정 전 |
| Datadog Logs 이중 적재 결정 | 운영 책임자 | 2556 컷오버 설계 전 |

## 10. 이 문서가 하지 않은 것

- dev·prod 서버, Docker, AWS, GCP, Datadog에 변경을 가하지 않았다.
- prod EC2에는 접속하지 않았다. AWS CLI는 SSO 만료로 사용하지 못했다.
- Fluent Bit·Loki를 설치하거나 기동하지 않았다. 용량 값은 계산 결과이며 실제 부하 시험은 하지 않았다(V09~V11, V21 미실행).
- 7일 이전의 로그량, 로그 한 줄 최대 크기, Docker 원본 대비 Datadog 수신 크기 비율을 측정하지 않았다.
- exactly-once나 무유실을 주장하지 않는다.
