# 로그 통합 검증 결과 V01–V23과 로컬 전후 측정 (GROMO-2560)

> 2026-10-29. 상태 기준은 코드·문서에 남은 근거뿐이다. 근거가 없는 항목은 «미실행»이다. 이 문서는 무유실·exactly-once·운영 성능 영향 없음을 주장하지 않는다.
> **AWS·dev·prod 로 요청을 보낸 적이 없다.** 측정은 로컬 macOS Docker 와 로컬 JVM 만 썼다(사용자 지시 2026-10-29: AWS 부하 테스트·부하용 데이터 생성 영구 금지).

관련: [구현 계획 §5 검증 매트릭스](implementation-plan.md#5-검증-매트릭스) · [구현 현황](implementation-status.md) · [수집 런북 §7](ingestion-runbook.md) · [조회 안내 §5](query-guide.md) · [전환·롤백 절차](rollout.md)

## 1. 상태 기준

| 상태 | 뜻 |
| --- | --- |
| 로컬 통과 | 통과 기준 전체를 자동 테스트 또는 로컬 하네스가 실제 경로로 확인했다. 근거 아래에 남은 한계를 적는다 |
| 부분 | 통과 기준의 일부만 로컬에서 확인했다. 확인한 부분과 못 한 부분을 구분해 적는다 |
| 미실행 | 통과 기준을 확인하는 실행이 없다 |

구분: **자동 테스트**(Gradle·unittest, CI 에서 도는 것), **로컬 하네스**(Docker 로 Fluent Bit·Loki·MinIO·Trino 를 띄우는 스크립트, CI 에서 안 돈다), **현장**(dev·prod 배포 뒤 확인). 현장 구분 항목은 모두 «미실행»이다. 피처 브랜치 병합은 main 반영도 배포도 아니다([구현 현황](implementation-status.md)).

## 2. V01–V23 결과

| ID | 구분 | 근거 | 상태 | 확인하지 못한 것과 사유 |
| --- | --- | --- | --- | --- |
| V01 | 자동 테스트 | Business `RequestLogPropagationTest`(요청 필터→조합 pool→HTTP pool→Data 헤더가 한 요청 ID, 같은 pool 재사용 시 새 ID), Data `TraceIdFilterTest`(PR #1380) | 부분 | 하위 span·retry attempt 를 trace 로 구분하는 부분은 Datadog agent 없이 확인할 수 없다. 로컬 JVM 에는 agent 가 없다. 병렬 호출·HTTP 재시도의 요청 ID 일치와 누출 0 만 확인 |
| V02 | 자동 테스트 | Business `RequestEnvelopeAccessLogTest`(413 거절·미처리 예외는 `status_code` 없이 `outcome=unhandled_exception`), `RequestLogPropagationTest`(취소·전송 실패 뒤 worker 에 ID 가 남지 않음) | 부분 | Data 의 401/403 은 `TraceIdFilter` 앞에서 끝나 요청 ID 가 없다([구현 현황 «아직 구현하지 않은 경계»](implementation-status.md)). 클라이언트 연결 종료·timeout 의 실제 서비스 로그 확인은 미실행 |
| V03 | 자동 테스트 | `RequestLogPropagationTest`(중첩 scope·예외 후 재사용 thread 에서 자기 키만 복원, 다른 MDC 보존), `TraceIdFilterTest`, 2559 `OutboundSendBudgetTest`·`StompLogScopeTest` | 부분 | tracer 문맥(`dd.*`)의 함께 전파·복원은 agent 필요 — 미검증. 예약 작업(`@Scheduled`)의 tracer 는 미실행 |
| V04 | 자동 테스트 | Data Outbox 통합 테스트(`OutboxCommandIntegrationTest`·`OutboxRelayIntegrationTest`·`OutboxRelayLeaseIntegrationTest`)와 `OutboxCarrierTest`(PR #1384). 재시도가 저장된 origin 을 읽기만 한다는 설명은 [구현 현황 2557 절](implementation-status.md) | 부분 | 프로세스 강제 종료 뒤 relay 재시작의 추적 재개는 테스트 안에서 relay 를 다시 호출하는 수준까지만. 실제 프로세스 kill 은 미실행 |
| V05 | 자동 테스트 | Notification `KafkaInboundTest`(재전달 시 최초 origin 유지, 모르는 버전은 DLT 파티션 보존, DLT 부재 시 확인(ack) 금지, 형식 오류 carrier 무시), Data `OutboxRelayFailureLogIntegrationTest` | 부분 | 시도별 span 구분은 agent 필요. 브로커 중단 자체는 미실행. Realtime Kafka 실제 브로커·DLT 헤더 보존은 리스너를 `ConsumerRecord` 로 직접 호출해 확인(구현 현황 2559 «미검증») |
| V06 | 자동 테스트 | Notification `DispatchOperationLinkTest`(재시도가 새 operation·다음 attempt 를 받고 origin 은 그대로, 구버전 행) | 부분 | Realtime 재접속과 «긴 연결 전체를 단일 trace 로 만들지 않음»은 확인하지 않았다. 스케줄러 스레드를 거치는 MDC 는 미검증 |
| V07 | 자동 테스트 + 로컬 하네스 | `ObservationJsonProviderTest`(4개 서비스, 예외 개행·중첩·자르기 표시), `ObservationJsonProfileTest`(별도 JVM stdout 한 줄 JSON), 수집기 하네스 `fluent-bit/local-test/run.sh`(40 KiB 앱 JSON 이 Docker 16 KiB 분할에서 한 줄로 재조립, JSON 아닌 줄은 `parse_error=true`·`log_kind=raw` 로 보관, 1 MiB 줄 처리)(PR #1383) | 로컬 통과 | 한계: 사전 자르기로 잘린 꼬리의 미완성 토큰이 노출될 수 있다(4서비스+Lua, 후속). 실배포 JSON 출력은 미검증 |
| V08 | 자동 테스트 + 로컬 하네스 | `MaskingConverterTest`·각 서비스 `LogMaskingTest`(토큰·비밀번호·이메일·휴대폰·주민번호), 하네스 raw 줄 마스킹(`token`·`Bearer`·`refresh` 등), Nginx query·Referer·경로 토큰·이메일 원문 0건(런북 §7 시나리오 i) | 부분 | MDC 값은 allowlist 와 형식 검증으로 제한(`ObservationJsonProviderTest`). S3 원본은 같은 정제 레코드를 보내지만 실제 S3 객체는 미실행. 사전 자르기 꼬리 한계는 V07 과 같다 |
| V09 | 로컬 하네스 | 런북 §7 a·b1·b2·c·h: 정상, SIGTERM·SIGKILL 재시작, 네트워크 분리, 수집기 정지 중 컨테이너 재생성. 대부분 누락 0·중복 0 | 부분 | 규모는 600~1200건. b1(SIGTERM)을 3회 돌려 1회에서 S3 1건 누락(원인 미확정). 소스 회전은 f2 에서만. 실제 dev 규모 미실행 |
| V10 | 로컬 하네스 | 런북 §7 d·d2·d3·d4(S3 정지·403), e·e2(Loki 정지), c(분리) | 부분 | 한쪽 정지가 다른 쪽에 영향을 주지 않음은 확인. 단 `Retry_Limit` 초과 정지는 S3 유실(수정 후 약 1시간), Loki 정지 뒤 연속 10~148건 누락(원인 미확정). 실제 S3 는 미실행 |
| V11 | 로컬 하네스 | 런북 §7 f1·f2(엔진·`store_dir` 한도를 일부러 작게) | 부분 | 한도 도달 시 오래된 청크부터 폐기, Loki 누락 수 = `dropped_records`, S3 중복(165·334)을 확인. 경보는 설계뿐. 디스크 포화는 미실행 |
| V12 | 현장 | 로컬 MinIO 의 객체 키·gzip JSONL 형식만 런북 §2 에서 확인 | 미실행 | 실제 S3·IAM·타 환경 쓰기 차단·90일 lifecycle·Athena 조회는 AWS 요청 금지로 실행하지 않았다. 로컬 Trino 로 SQL 은 검증([조회 안내 §5·§6](query-guide.md)) |
| V13 | 자동 테스트 | `ObservationJsonProviderTest`(`dd.*` 가 `"0"`·부재여도 정상 출력), 하네스(trace 없는 Nginx 로그도 Loki·S3 도착) | 부분 | APM 샘플 제외·전송 실패·보존 만료는 agent·backend 필요 — 미실행. «trace 부재 표시» 화면은 확인하지 않았다 |
| V14 | 로컬 측정 | 이 문서 §3(앱 인코딩 비용)·§4(수집기 비용) | 부분 | 요청 p95/p99 전후 비교는 미실행. 사유: 로컬 서비스 전체 부하는 이번 범위 밖, dev·prod 에는 부하를 가하지 않는다(AWS 부하 금지·원격 변경 금지). 배포 뒤 저장 지표로 비교하는 방법은 §5 |
| V15 | 자동 테스트 | Data `OutboxOriginV7MigrationTest`·Notification `DeliveryOriginV16MigrationTest`(이전 번들 migrate·validate 통과, nullable), Realtime `InboundEventServiceTest`(신→구·구→신 wire 양방향), Notification `KafkaInboundTest`(carrier 없는 이벤트), Data `ObservationJsonProfileTest`(APP 텍스트 파일 유지, user-activity 분리) | 부분 | 실제 롤링 배포의 혼합 상태와 이중 수집·기존 파일 누락 없음은 미실행 |
| V16 | 자동 테스트 | `DispatchOperationLinkTest`(기기마다 operation, origin 별 조회 분리, 구성원 2개 link 단위 테스트) | 부분 | 티켓 2421 로 묶음이 제거되어 한 호출의 구성원이 1개다. «서로 다른 원요청 2개를 한 푸시로 병합»은 지금 경로에서 도달할 수 없다 |
| V17 | 자동 테스트 | Realtime `FanoutLogContextIntegrationTest`(같은 JVM 두 컨텍스트, 실제 Redis·Postgres: STOMP 프레임→팬아웃 origin, 두 채널 구독·아웃바운드 연결, 자기 echo, 손상 telemetry 가 전달을 막지 않음), `TwoInstanceFanoutTest`, `FanoutTelemetryTest`, `InboundEventServiceTest`(PR #1386) | 부분 | 서로 다른 프로세스 두 인스턴스와 단절은 미실행(단절을 구분하는 로그는 없다 — 2559 후속). 바다·이동 채널은 telemetry 없음 |
| V18 | 자동 테스트 | `OutboxCarrierTest`, `KafkaInboundTest`(`internalHttpAdoptsCarrierOnlyAfterServiceAuthAndFallsBackToRequestId`, 중복 수신이 기존 origin 을 덮지 않음) | 부분 | 후속 4건 미구현: 멱등 재요청 로그의 기존 origin, Data `/internal/*` 의 `X-Origin-*` 채택(T1→T2→T3 origin 유지가 닫히지 않음), 불량 carrier 카운터, 공통 내부 HTTP client 전파. agent 미활성 상태는 로컬 JVM 이 곧 이 상태 |
| V19 | 로컬 하네스 | 런북 §7 시나리오 i(prod 컨테이너 Nginx 200건·dev 호스트 파일 400건 도착, 회전 포함, upstream `X-Request-Id` 연결, 502·413) | 부분 | 실제 dev `nginx.conf`·logrotate·prod 설정(Infra)은 미실행. error 로그는 요청 단위 연결을 주장하지 않는다 |
| V20 | 자동 테스트 | `.github/scripts/test_obs_metadata.py`·`test_deploy_core_dev.py`·`test_prepare_satellite_deploy.py`(렌더된 OBS 값이 서비스·환경·배포 커밋과 다르면 배포 중단), 각 `ObservationJsonProfileTest`(실제 yml/xml 을 로드한 별도 JVM 의 stdout) | 부분 | 실제 컨테이너 env 와 실기동 로그의 일치, APM 링크는 미실행(배포 게이트) |
| V21 | 로컬 하네스 | 수집기 하네스 (g)(30분 전 줄 수용·3시간 전 줄 거절), 런북 §7 g(59분 수용·61분 거절) | 부분 | 30분 backlog 는 3분으로 축소. 거절된 줄을 S3 에서 대조하는 흐름은 미실행(Loki 정지 시나리오 e 에서 S3 에는 있음을 확인한 것이 전부). 시계 오차는 조회 안내 §3.4 의 `clock_skew_suspect` 로 표시하는 것까지 |
| V22 | 로컬 하네스 | `log-query/local-test/run.sh`: 같은 시각 1200줄에서 표 1000줄·줄 수 패널 1200, 서비스별 분할, Athena SQL(Trino) 1200행 대조([조회 안내 §5](query-guide.md)) | 부분 | 브라우저 화면(패널 색·링크)과 live tail 단절은 확인하지 않았다 |
| V23 | 자동 테스트 | Business `RequestEnvelopeAccessLogTest`(미처리 예외를 200 으로 기록하지 않음), [구현 현황 2553 절](implementation-status.md)의 외부 `X-Request-Id` 비채택(테스트 클래스는 이 문서에서 대조하지 않음) | 부분 | 외부 `traceparent` spoof 의 신뢰 문맥 분리는 agent 필요. error/async dispatch 재진입은 다루지 않았다(구현 현황) |

### 상태 분포

| 상태 | 개수 | 항목 |
| --- | --- | --- |
| 로컬 통과 | 1 | V07 |
| 부분 | 21 | V01–V06, V08–V11, V13–V23 |
| 미실행 | 1 | V12 |

(집계는 위 표를 항목별로 세었다: 1 + 21 + 1 = 23. PR 본문의 «로컬 통과 1·부분 21·미실행 1»과 같다.)

«통과 기준 전체를 확인한 항목»은 V07 하나뿐이다. 나머지는 로컬에서 확인한 부분만 근거로 삼고, 현장(dev·prod 배포) 확인은 전부 비어 있다.

### 전체 로컬 실행 숫자(출처에서 옮김)

| 범위 | 결과 | 출처 |
| --- | --- | --- |
| Realtime 최신(피처 병합 트리) `cleanTest build` | 829개, 실패 0 | 2559 병합 뒤 로컬 실행 |
| Data 전체 | 1,887개, 실패·오류 0(2555 병합 트리 기준) | [구현 현황 2557 절](implementation-status.md) |
| Notification 전체 `build` | 232개, 실패 0 | [구현 현황 2558 절](implementation-status.md) |
| Business 전체 | 2,216개(2555 병합 트리) | [구현 현황 2555 절](implementation-status.md) |
| `.github/scripts` unittest | 347개 통과 | 구현 현황 2555 절·PR #1390 본문 |
| 수집기 하네스 `run.sh`·`run-s3.sh` | 런북 §7 의 시나리오별 값 | [수집 런북 §7](ingestion-runbook.md) |
| 조회 하네스 `log-query/local-test/run.sh` | 실패 0, 변형 5종이 15건 실패 | [조회 안내 §5](query-guide.md) |

서비스별 숫자는 각 시점의 병합 트리 기준이라 서로 같은 커밋이 아니다. 같은 커밋의 4서비스 전체 재실행은 이 문서에서 하지 않았다.

## 3. 로컬 측정 1: 앱 로깅 비용 (V14 일부)

환경: 로컬 macOS(Darwin 25.6), Corretto 21.0.11, 단일 JVM, 대표 부하 아님. 요청 p95/p99 가 아니라 **인코딩 한 건의 비용**이다. 같은 이벤트를 «옛»(main `logback-spring.xml` 의 `PatternLayoutEncoder` 패턴 + `%mask`)과 «새»(`StructuredLogEncoder` + `ObservationJsonProvider`)로 인코딩한다. 이벤트는 건마다 새로 만든다(재사용하면 logback 이 스택 줄 문자열을 이벤트에 캐시해 옛 쪽 스택 비용이 사라진다. 처음 한 번 그렇게 재서 틀린 값이 나와 고쳤다). 시나리오마다 워밍업 후 5라운드를 옛·새 교대로 쟀다.

실행(기본 빌드에서는 건너뛴다 — 환경변수 `LOGGING_PERF=1` 일 때만 돈다):

```bash
cd server/data-api
LOGGING_PERF=1 SPRING_PROFILES_ACTIVE=ci ./gradlew cleanTest test --no-daemon --tests '*LoggingEncodingPerfTest'
```

테스트: [`LoggingEncodingPerfTest`](../../../server/data-api/src/test/java/com/oneorthree/phone/common/logging/LoggingEncodingPerfTest.java). 출력 그대로(단위 µs, 1회 실행):

```text
로컬 macOS 단일 JVM, 대표 부하 아님. 인코딩 비용만(요청 p95/p99 아님). 건당 System.nanoTime 계측 오버헤드(수십 ns) 포함.
옛 = PatternLayoutEncoder(main 패턴 + %mask), 새 = StructuredLogEncoder + ObservationJsonProvider. 단위 µs.
| 시나리오 | 방식 | 건수 | p50 | p95 | p99 | 최대 | 출력 바이트 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 짧은 줄(약 60B) | 옛 패턴 | 20000 | 2.3 | 3.9 | 10.3 | 131.2 | 145 |
| 짧은 줄(약 60B) | 새 JSON | 20000 | 8.0 | 14.7 | 39.0 | 1509.6 | 581 |
| 4 KiB 메시지 | 옛 패턴 | 10000 | 252.9 | 401.0 | 554.2 | 3108.3 | 4208 |
| 4 KiB 메시지 | 새 JSON | 10000 | 276.3 | 446.0 | 568.0 | 8947.0 | 4644 |
| 40 KiB 메시지(JSON 은 16 KiB 로 자름) | 옛 패턴 | 2000 | 2792.4 | 3488.8 | 4097.5 | 12237.3 | 41072 |
| 40 KiB 메시지(JSON 은 16 KiB 로 자름) | 새 JSON | 2000 | 2222.7 | 2844.0 | 3195.2 | 5795.5 | 16977 |
| 스택 포함(깊이 40) | 옛 패턴 | 5000 | 2.8 | 7.9 | 19.7 | 1645.1 | 2414 |
| 스택 포함(깊이 40) | 새 JSON | 5000 | 154.6 | 267.3 | 406.5 | 639.1 | 2946 |
| 스택 포함(깊이 800, JSON 은 32 KiB 로 자름) | 옛 패턴 | 500 | 44.1 | 82.5 | 148.9 | 225.2 | 46054 |
| 스택 포함(깊이 800, JSON 은 32 KiB 로 자름) | 새 JSON | 500 | 3189.8 | 4229.3 | 5424.8 | 45037.4 | 34534 |
```

읽는 법(측정값에서 직접 읽을 수 있는 것과 추정을 구분한다):

- 짧은 줄: 새 쪽이 p50 +5.7 µs, 출력은 145 → 581 바이트(약 4배). 필드(`schema_version`·`log_id`·`service` 등)가 늘어난 결과다. 줄이 짧아 건당 `System.nanoTime` 계측 오버헤드(수십 ns)가 차지하는 비중이 크다. 이 비율(2.3 → 8.0 µs)을 일반화하지 않는다.
- 4 KiB: p50 253 → 276 µs(약 +9%). 두 쪽 모두 마스킹이 지배한다(**추정** — 짧은 줄과 비교한 비용 증가가 길이에 비례).
- 40 KiB: 새 쪽이 더 빠르다(p50 2,792 → 2,223 µs). **추정**: 새 쪽은 마스킹 전에 입력을 먼저 자르고(한도의 2배), 옛 쪽은 40 KiB 전체를 마스킹한다.
- 스택 포함: 새 쪽이 크게 느리다(깊이 40: 2.8 → 154.6 µs, 깊이 800: 44.1 → 3,189.8 µs). **같은 일 비교가 아니다 — 새 쪽은 예외 마스킹을 하고 MDC 필드(`request_id` 등)를 더 출력한다. 이 배수(약 55배)를 단독으로 인용하지 않는다.** 옛 패턴의 `%mask`는 메시지만 마스킹하고(`MaskingConverter` 는 `MessageConverter`) 예외는 마스킹하지 않는다. 새 쪽은 예외도 4규칙으로 마스킹하고 32 KiB 로 자른다. 정책상 필요한 추가 일이다.
- 참고 계산(단순 곱셈, 로깅 스레드 직렬 가정): 깊이 40 스택 로그가 초당 100건이면 100 × 154.6 µs ≈ 15 ms/s, 코어 1개의 약 1.5%.
- 최대값(수 ms~수십 ms)은 GC·JIT 영향으로 보이나 원인을 확인하지 않았다. p99 까지를 본다.

## 4. 로컬 측정 2: 수집기 비용 (V14 일부)

환경: 로컬 macOS Docker Desktop(8 vCPU·약 8 GB, 다른 로컬 컨테이너가 함께 떠 있음), Fluent Bit 4.2.8, Loki 3.3.2(dev 와 같은 이미지·설정 디렉터리, 읽기 전용 마운트). 대표 부하 아님. 이 한 번의 실행이 전부라 분포는 모른다.

생성기는 스키마 v1 앱 JSON 한 줄(약 475 바이트, Docker 래퍼 제외)을 고정 속도로 60초간 낸다. 하네스: [`server/observability/log-query/perf/`](../../../server/observability/log-query/perf/) — `collector_cost.py`(측정), `rate_gen.py`(생성기), `docker-compose.yml`(프로젝트 `obs2562-2560perf`, 포트 23100·22020). 2556 하네스(`fluent-bit/local-test/`)는 수정하지 않았고 같은 이미지·설정 디렉터리만 쓴다. 끝나면 `down -v` 로 컨테이너·볼륨을 지운다.

```bash
python3 server/observability/log-query/perf/collector_cost.py 200:60 1000:60
```

| 속도 | 보낸 줄 | Loki 도착 | 누락 | 도착 지연 초 p50 / p95 / p99 / 최대 | Fluent Bit CPU % 평균 / p95 / 최대 | 메모리 MiB 최대 | 상태 볼륨 KiB 최대 | `dropped` / `retried` / `errors` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 200/s × 60s | 12000 | 12000 | 0 | 1.28 / 2.63 / 5.03 / 5.63 | 3.3 / 4.9 / 5.2 (유휴 0.31) | 35.2 (유휴 33.4) | 4192 | 0 / 0 / 0 |
| 1000/s × 60s | 60000 | 60000 | 0 | 1.41 / 2.67 / 5.07 / 5.67 | 5.2 / 7.6 / 8.7 (유휴 0.36) | 40.9 (유휴 33.3) | 4544 | 0 / 0 / 0 |

- CPU 는 `docker stats --no-stream` 을 반복 호출한 값이고 100% 가 코어 1개다(샘플 32·32개). 상태 볼륨은 `du -sk`(tail DB + 엔진 버퍼) 10초 간격 7개 샘플이라 최대값은 하한이다.
- 도착 지연은 «Loki 가 줄을 응답으로 돌려준 첫 시각 − 생성기가 줄을 낸 시각»이다. 조회 간격이 약 1.5초라 해상도는 약 2초이고, 생성기 시계(Docker VM)와 호스트 시계의 차이(시작·끝 평균, 각각 +13.8~+19.7 ms, 왕복 약 50 ms)를 빼 보정했다. 런북 §7 의 지연(2초 해상도)과 같은 방식이다.
- p99 가 두 속도 모두 약 5초인 이유는 확인하지 않았다.
- 이 실행은 정상 상태만 본다. 장애·한도 도달 동작은 [런북 §7](ingestion-runbook.md)이 다룬다. 호스트 디스크 I/O·Loki 쪽 비용은 재지 않았다.

원출력(스크립트 출력 JSON 한 줄씩):

```json
{"rate": 200, "seconds": 60, "emitted": 12000, "received": 12000, "missing": 0, "clock_offset_ms_start_end": [13.8, 19.1], "clock_rtt_ms_start_end": [45.5, 55.2], "lat_s": {"p50": 1.28, "p95": 2.63, "p99": 5.03, "max": 5.63}, "lat_negative": 0, "cpu_pct_idle": 0.31, "mem_mib_idle": 33.4, "cpu_pct": {"samples": 32, "mean": 3.3, "p95": 4.9, "max": 5.2}, "mem_mib_max": 35.2, "disk_kib_max": 4192, "disk_samples": 7, "fluent_bit": {"loki.0": {"proc_records": 12002, "retried_records": 0, "dropped_records": 0, "errors": 0}}, "wall_s": 65.4}
{"rate": 1000, "seconds": 60, "emitted": 60000, "received": 60000, "missing": 0, "clock_offset_ms_start_end": [17.2, 19.7], "clock_rtt_ms_start_end": [54.4, 53.7], "lat_s": {"p50": 1.41, "p95": 2.67, "p99": 5.07, "max": 5.67}, "lat_negative": 0, "cpu_pct_idle": 0.36, "mem_mib_idle": 33.3, "cpu_pct": {"samples": 32, "mean": 5.2, "p95": 7.6, "max": 8.7}, "mem_mib_max": 40.9, "disk_kib_max": 4544, "disk_samples": 7, "fluent_bit": {"loki.0": {"proc_records": 60002, "retried_records": 0, "dropped_records": 0, "errors": 0}}, "wall_s": 65.7}
```

## 5. 요청 p95/p99 전후 비교: 배포 뒤 저장 지표로 (미실행)

V14 의 본래 의미인 «같은 부하 조건에서 요청 p95/p99 전후 비교»는 하지 않았다. 로컬 서비스 전체 부하는 이번 범위 밖이고, dev·prod 에는 부하를 가하지 않는다(AWS 부하 금지·원격 변경 금지).

배포 뒤에는 **새 부하를 만들지 않고** 이미 쌓이는 지표를 읽기 전용으로 비교한다.

1. 전후 같은 요일·시간대의 창을 고른다(예: 배포 전 7일 중 같은 요일 평일 낮 2시간, 배포 후 같은 요일 같은 시간). 트래픽이 다르면 요청률도 함께 적는다.
2. Grafana `gromo-overview` 의 `http_server_requests_seconds_bucket` 패널로 서비스별 p95·p99 와 요청률을 읽는다. Datadog 이 켜진 곳은 같은 조건으로 APM 지연 분포를 읽는다(조회만).
3. `gromo-components` 의 «서비스 CPU 사용률»·«컨테이너 CPU (코어 수)»·«컨테이너 메모리 working set»·«프로세스 CPU · 메모리 · GC»·«호스트 디스크 I/O 사용률»을 같은 창으로 읽는다.
4. 수집 지연은 canary(Loki·S3 각각의 마지막 canary 나이)와 Fluent Bit `/api/v1/metrics` 의 `dropped_records`·`retried_records` 로 본다([전환 판정 지표](rollout.md#4-전환-판정-지표와-확인-쿼리)).
5. 구현 계획 V14 의 «p95 악화 5% 이하»는 합의 전 제안값이다. 결과에 맞춰 조용히 완화하지 않는다. 전후 창의 트래픽이 달라 비교가 성립하지 않으면 «비교 불가»로 적는다.

## 6. 미실행 사유 목록

| 사유 | 해당 |
| --- | --- |
| 배포 게이트(dev·prod 미배포, main 미반영) | 실배포 JSON·OBS 값·APM 링크(V20), 혼합 배포(V15), 요청 p95/p99(V14), 실제 span·sampling(V01·V03·V05·V13·V23) |
| AWS 요청 금지(사용자 지시 2026-10-29) | 실제 S3·IAM·lifecycle·Athena(V12), S3 쪽 실제 도착(V09~V11 의 AWS 판) |
| Infra 소유(`OneOrThree/Infra`) | prod Nginx `log_format`·Fluent Bit 서비스·IAM(V19, V12) |
| Datadog agent 가 로컬에 없음 | trace 연결·sampling·보존(V01·V03·V05·V13·V23) |
| 구조상 지금 도달 불가 | 묶음 병합 푸시(V16, 티켓 2421) |
| 후속 구현 대기 | 멱등 재요청 origin·`/internal/*` 채택(V18), 단절 로그(V17), 인증 이전 요청 ID(V02) |
| 범위 축소 | 30분 backlog 를 3분으로(V21), 600~6000건 규모(V09~V11) |
| 확인 안 함 | 브라우저 화면(V22), 호스트 디스크 포화(V11) |
