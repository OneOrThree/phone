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
| 디스크 `/` | 49 GB 중 사용 31 GB, **여유 18 GB (65% 사용)** | 실측 |
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
- 서비스 `nginx`(env 불명)는 7일 합계 94 MB, 1분 최대 6.9 MB이다. dev 호스트 Nginx인지 prod인지 태그만으로 판별되지 않아 합산하지 않고 민감도로만 쓴다.
- `catus-notification-prod`는 로그 지표 시리즈가 없다. APM span은 있다(§3.2). 지표가 없는 이유는 확인하지 않았다 — 미확인.
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

**먼저 알아둘 점.** `server/scripts/docker-compose.prod.yml`은 단일 앱(`gromo-app`, `DD_SERVICE=gromo-back-prod`) 구성이다. 문서 `docs/prd/fishcat/server-separation/deployment.md:78`은 Catus 2.0 운영 실행 구성·nginx·SSM 배포 문서가 별도 Infra 저장소(`prod/catus/runtime`)에서 관리된다고 한다. 따라서 아래 값이 현재 Catus 운영 컨테이너 설정과 같은지는 **확인되지 않았다**(§3의 Datadog 서비스명 `catus-*-prod`가 이를 뒷받침한다).

| 항목 | 설정상 값 | 근거 |
| --- | --- | --- |
| 앱 이미지 | ECR 저장소 `catus-prod/<service>`, `linux/arm64`, 릴리스에 digest 조합 기록 | `.github/workflows/prod-ci.yml:152,171-172`, `deployment.md:100-101` |
| 실행 구성 고정 | `CATUS_PROD_INFRA_REVISION` 40자리 SHA, S3 `configurations/<SHA>/configuration.zip` 검증 | `prod-ci.yml:70,93`, `deployment.md:78` |
| 배포 방식 | `prod-cd.yml`, SSM 전송 | `.github/workflows/prod-cd.yml:55-80` |
| DD agent | `gcr.io/datadoghq/agent:7`(태그 고정 아님), `DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true`, `DD_LOGS_CONFIG_DOCKER_CONTAINER_USE_FILE=true`, APM 활성 | `docker-compose.prod.yml:88,104,108,112` |
| 로그 오프셋 | named volume `datadog_agent_run` | `docker-compose.prod.yml:121` |
| tracer | dd-java-agent 1.64.0 jar를 각 Dockerfile이 포함 | `server/data-api/Dockerfile:43`, `server/business-api/Dockerfile:40`, `server/notification/Dockerfile:41`, `server/realtime/Dockerfile:41` |
| `DD_ENV`, `DD_TRACE_SAMPLE_RATE` | prod, 0.2 (1.x 앱 구성) | `docker-compose.prod.yml:35,38` |
| `DD_LOGS_INJECTION` | true | `docker-compose.prod.yml:41` |
| Docker log 옵션 | 앱·nginx `50m x 4`, 인프라 `10m x 3` | `docker-compose.prod.yml:14-19`, `server/scripts/README.md:140-141` |
| Nginx | **컨테이너** `nginx:1.28-alpine`(`gromo-nginx`), 서비스 태그 `gromo-nginx-prod` | `docker-compose.prod.yml:58-77` |
| 앱 파일 로그 | 호스트 `/var/log/springboot`를 `/app/logs`에 바인드(`app.log`, `user-activity.log`) | `docker-compose.prod.yml:46-49` |
| S3 업로더 | 호스트 systemd 타이머, 매시간, 티켓 590. `user-activity/` 접두는 Fluent Bit 전환 예정(790, 미완) | `server/scripts/README.md:250-254` |
| 업로더 중복 | 2288(새 prod·호스트 업로더)과 위 590 타이머의 공존 여부 미확인 | `implementation-status.md` 2288 기재 |
| lifecycle 규칙(기록) | `system_log/`·`user_log/`·`user-activity/` 각 90일, 불완전 multipart 1일 | `server/scripts/s3-log-archive-lifecycle.json:1-24` |
| 컷오버 | 2026-10-14 Catus 전환 완료, 로그 아카이브 확인 문구가 있으나 세부는 Infra 문서에 있음 | `deployment.md:93` |

저장소에 적힌 «적용 완료 2026-09-19»와 «Terraform 원본과 어긋남(GROMO-1948)»(`server/scripts/README.md:258-260`)은 **과거 기록**이다. 구현 계획 P0 5번대로 실측을 대신하지 않는다. 버킷 이름은 12자리 계정 ID를 포함하므로 이 문서에서는 `gromo-prod-logs-<ACCOUNT_ID>`로 쓴다(실제 이름은 `server/scripts/README.md:248`).

## 5. 용량 계산

공식은 [구현 계획 §4](implementation-plan.md#4-데이터-신뢰성과-용량-설계)를 따른다.

```text
필요 버퍼 = peak bytes/sec x 견딜 중단 시간(sec) x 여유 계수
```

### 5.1 입력

| 입력 | 값 | 근거 |
| --- | --- | --- |
| 견딜 중단 시간 | 1,800초(30분) | 구현 계획 P0의 초기 시험 조건 |
| 여유 계수 | 2 | 추정. 근거: (a) Datadog 지표는 수신 크기라 Docker 원본·JSON 변환 후 크기와 다르다 (b) 서비스별 peak를 시간이 다른 구간에서 합산하지 않고 한 번에 겹치는 최악으로 잡은 것과 별도로, parser가 필드를 붙여 줄이 커질 수 있다. 실측 후 조정한다 |
| peak 기준 | **Datadog 1분 최대의 서비스별 합**. 같은 분에 겹쳤다는 증거는 없으므로 보수적 상한이다 | §3.1 |
| prod 합산 대상 | catus-realtime, business-api, data-api, kafka, gromo-nginx-prod (notification은 지표 없음, 1.x `gromo-back-prod` 제외) | §3.1 |
| dev 합산 대상 | gromo-data/business/realtime/notification, kafka, db, back(옛 이름) | §3.1 |
| 한 줄 최대 크기 | 측정하지 않음 | 미확인 |

dev 60초 샘플(합 약 345 B/s)은 peak 근거로 쓰지 않는다. DD 7일 값을 우선한다.

### 5.2 peak 계산

| | 1분 최대 합(B/min) | peak(B/s) | 비교: 5분 최대 합(B/s) | 비교: 7일 평균(B/s) |
| --- | --- | --- | --- | --- |
| prod | 26,260,824 | **437,680** | 213,894 | 739 |
| dev | 1,085,927 | **18,099** | 4,609 | 385 |

prod에서 `nginx`(env 불명) 6,927,666 B/min를 더하는 민감도: 합 553,142 B/s.

### 5.3 버퍼와 store_dir

`storage.total_limit_size`(engine 디스크 버퍼)와 S3 output의 `store_dir_limit_size`는 역할이 달라 각각 산정한다([조사 기록](research.md)). 같은 데이터가 두 곳에 동시에 있을 수 있어 디스크 합계에는 둘을 모두 더한다.

| | 계산 | prod | dev |
| --- | --- | --- | --- |
| engine buffer (`storage.total_limit_size`) | peak x 1,800 x 2 | 1,575,604,800 B = **1.58 GB** | 65,156,400 B = **65 MB** |
| S3 `store_dir_limit_size` | peak x 1,800 x 2 (S3만 30분 중단 가정) | **1.58 GB** | **65 MB** |
| 30분 중단 순수 적체(여유 계수 1) | peak x 1,800 | 787.8 MB | 32.6 MB |

`store_dir`을 gzip 전 크기로 잡았다(추정, 압축 상태 미확인). 한 번에 업로드하는 청크 크기와 `timeout`에 따른 임시 파일은 Fluent Bit 버전·설정 확정 후 더한다.

### 5.4 호스트 디스크 합계

필요 디스크 = Docker 회전본 상한 + engine buffer + store_dir + 임시 + 운영 여유.

| 항목 | dev | prod |
| --- | --- | --- |
| Docker 회전본 상한 | 앱 4개 x 200 MB + 인프라 10개 x 30 MB = **1.1 GB** (현재 사용 76 MB) | 앱 4 + nginx x 200 MB + 인프라 N x 30 MB. N 미확인 → 최소 **1.0 GB + 30 MB x N** |
| engine buffer | 65 MB | 1.58 GB |
| store_dir | 65 MB | 1.58 GB |
| 임시 파일 | 100 MB(추정) | 500 MB(추정) |
| 소계(운영 여유 제외) | 약 **1.33 GB** | 약 **4.7 GB + 30 MB x N** |
| 디스크 크기·여유 | 49 GB, 여유 18 GB(실측) | **미확인**(차단 조건) |
| 판정 | 여유 18 GB 대비 7.4% — 충분 | 디스크 크기 확인 전 판정 불가 |

### 5.5 경보 임계값 후보

| 경보 | 임계 | dev 대입 | prod 대입 |
| --- | --- | --- | --- |
| 가용 디스크 20% 이하 | 총 용량의 20% | 49 GB x 0.2 = **9.8 GB**. 현재 여유 18 GB(36.7%)는 위쪽이며 임계까지 여유 8.2 GB | 총 용량 미확인 |
| engine buffer 80% 이상 | 0.8 x total_limit_size | 52 MB | 1.26 GB |
| S3 store_dir 80% 이상 | 0.8 x store_dir_limit_size | 52 MB | 1.26 GB |

dev는 현재 여유 18 GB가 임계 9.8 GB보다 높지만, Docker 회전본이 상한까지 차고(1.1 GB) journald 1.7 GB가 늘면 여유가 줄 수 있다. swap 사용과 메모리 available 2.7 GB 상태에서 Fluent Bit과 Loki를 동시에 올릴 때의 메모리는 이 조사에서 계산하지 않았다(P0 6번, 미확인).

## 6. S3·IAM·암호화 확인 (미확인, 배포 차단)

AWS 접근 불가로 아래는 모두 **미확인**이다. 하나라도 확인되지 않으면 S3 포함 배포(P2)를 하지 않는다.

| 항목 | 상태 | 차단 조건 | 확인 방법(읽기 전용) |
| --- | --- | --- | --- |
| 버킷 이름·리전 | 설정상(저장소에 이름 있음) | 실제 존재·리전 불일치 | `aws s3api head-bucket` |
| lifecycle 실제 적용 | 설정상(JSON 파일 + «적용 완료» 기록). Terraform 원본과 어긋났다는 과거 기록 있음 | 접두 3개 규칙 90일·`AbortIncompleteMultipartUpload` 1일이 실제 버킷에 없음. `system_log/v2/` 접두가 규칙 범위 | `get-bucket-lifecycle-configuration` |
| 암호화 | 미확인 | 기본 암호화 미설정 | `get-bucket-encryption` |
| versioning | 미확인 | 켜져 있으면 비현재 버전 만료 규칙 필요 | `get-bucket-versioning` |
| 불완전 multipart | 미확인 | 오래된 업로드 잔존 | `list-multipart-uploads` |
| Fluent Bit 쓰기 IAM | 미확인 | `system_log/v2/` 최소 권한 + 타 환경 쓰기 차단 + 삭제 불가 확인 불가 | IAM 역할·정책 조회(아래) |
| dev -> S3 자격 방식 | 미결정 | dev에 AWS 자격 경로 없음(aws CLI만 설치) | 결정 필요 |
| 롤백 소유자 | 미확인 | S3 설정·업로더 롤백 담당 미지정 | 담당 확인 |
| 업로더 중복(590 timer / 2288) | 미확인 | 이중 적재로 중복 | prod 호스트 `systemctl list-timers` |

재영님이 `aws sso login` 후 실행할 읽기 전용 명령(버킷 이름은 저장소 `server/scripts/README.md`의 값으로 바꾼다):

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
aws --profile gromo iam list-roles --query "Roles[?contains(RoleName,'log') || contains(RoleName,'fluent')].RoleName"
aws --profile gromo iam list-attached-role-policies --role-name <ROLE_NAME>
aws --profile gromo iam list-role-policies --role-name <ROLE_NAME>
```

결과를 문서에 남길 때 계정 ID, 키, 정책 본문의 시크릿 값은 가린다.

## 7. P0 10항목 판정

`확인`은 실측, `설정상`은 저장소 값, `미확인`은 차단 조건이다.

| # | 항목 | dev | prod |
| --- | --- | --- | --- |
| 1 | image digest·compose·JVM 옵션·agent·`DD_*` | **확인**: §2.2 digest, 4서비스 `DD_*`, tracer 1.64.0 | 설정상: §4. Catus 실제 컨테이너 env·digest는 **미확인**(Infra 소유). 차단: prod 컨테이너 env 확인 전 prod 활성화 보류 |
| 2 | 자동 계측(HTTP·executor·Kafka·JDBC) | 미확인: 이 조사에서 span 종류를 보지 않음 | 미확인 |
| 3 | 128-bit trace ID·`traceparent`·JSON 출력 | 미확인: `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED` 미설정, 1.64.0 기본값 미확인 | 미확인 |
| 4 | 서버별 bytes/sec·peak·최대 줄·예외·회전 | **부분 확인**: §3 DD 7일 peak, 최대 줄 크기 미측정 | **부분 확인**: §3 DD 7일. 호스트 Docker 로그 증가량·최대 줄 미확인 |
| 5 | S3 업로더·마지막 객체·lifecycle·versioning·암호화·IAM·multipart | **확인**: 업로더 없음 | 미확인(§6). 차단 |
| 6 | Loki·Datadog 실제 사용·보존·egress 비용·메모리 합계 | **확인**: Loki 미가동, Datadog 로그·APM 사용 중. 보존 기간·비용·메모리 합계 미확인 | 설정상: Datadog agent 로그·APM 활성. 보존·비용 미확인 |
| 7 | canary·실험 로그의 별도 저장 위치·만료 | 미확인(미결정) | 미확인(미결정) |
| 8 | source inventory(경로·회전·권한·cursor·담당) | **확인**: 앱=Docker json-file, Nginx=호스트 파일 `/var/log/nginx`(logrotate 14일), 컨테이너 Nginx 없음. cursor·담당 미정 | 설정상: 앱=Docker json-file + 호스트 `/var/log/springboot` 파일, Nginx=컨테이너 stdout, RDS. 실제 경로·권한 미확인 |
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
7. dev에 Loki가 없으므로 2555 검증은 로컬 또는 `ops-monitor.dev.yml` 기동 후 진행.

## 9. 다음 확인 담당·시점

| 확인 | 담당 | 시점 |
| --- | --- | --- |
| §6 AWS 읽기 전용 명령 실행과 결과 기록 | 재영님(`aws sso login` 필요) | 2556 착수 전, P2 배포 전 |
| prod 호스트 디스크·컨테이너 env·타이머 확인 | 재영님 또는 Infra 담당(SSM) | P0 완료 전 |
| 128-bit trace ID 기본값, 대표 요청의 로그·span ID 일치 | 2555 구현 담당 | 2555 dev 검증 |
| peak 급증 구간의 원문 줄 크기 샘플(개인정보 없는 합성 재현) | 2555·2556 담당 | 수집기 부하 시험 전 |
| 여유 계수·버퍼 크기 재산정 | 2554 후속 | 위 실측 후 |
| Datadog Logs 이중 적재 결정 | 재영님 | 2556 컷오버 설계 전 |

## 10. 이 문서가 하지 않은 것

- dev·prod 서버, Docker, AWS, GCP, Datadog에 변경을 가하지 않았다.
- prod EC2에는 접속하지 않았다. AWS CLI는 SSO 만료로 사용하지 못했다.
- Fluent Bit·Loki를 설치하거나 기동하지 않았다. 용량 값은 계산 결과이며 실제 부하 시험은 하지 않았다(V09~V11, V21 미실행).
- 7일 이전의 로그량, 로그 한 줄 최대 크기, Docker 원본 대비 Datadog 수신 크기 비율을 측정하지 않았다.
- exactly-once나 무유실을 주장하지 않는다.
