# 로그 통합 티켓과 구현 현황

작성: 2026-10-29. 구현 기준: `main`의 `81ef2140ab87f3c0f2bfb741bc3c6ae09f3c9932`.
작업 브랜치: `bfeat/GROMO-2553-request-log-context`.

기존 작업 폴더의 변경과 분리한 worktree에서 작업한다. 아래 **로컬 구현·검증**은 배포·S3 적재·Datadog 실측 완료를 뜻하지 않는다. 2553의 구현은 `epic-batch` 인계 커밋으로 보존한다. 티켓별 PR 생성·리뷰와 나머지 구현은 에픽 배치에서 이어간다.

## 티켓과 선후관계

전체 티켓은 조재영 담당, `관측·분석` 도메인이다. 2026-10-29 사용자 지시로 [에픽 2562](https://romance.atlassian.net/browse/GROMO-2562)에 8개를 묶고, 에픽 포함 9개를 활성 **SCRUM Sprint 17**(id 469, 2026-11-01 종료)에 넣었다. 개별 기한은 별도로 지정하지 않았다. 예상 시간은 계획용 추정이며 실제 소요 시간이나 납기 약속이 아니다.

| 티켓 | 검증 가능한 작업 단위 | 선행 | 초기 예상 | 현황 |
| --- | --- | --- | --- | --- |
| [2553](https://romance.atlassian.net/browse/GROMO-2553) | Business 요청 → 조합 worker → HTTP worker → Data 요청 로그 연결 | 없음 | 8h | 진행 중, 아래 로컬 구현 |
| [2554](https://romance.atlassian.net/browse/GROMO-2554) | 실제 수집 경로·버전·용량·IAM·보존·업로더 조사 | 없음, 2553과 병행 | 4h | 스프린트 대기 |
| [2555](https://romance.atlassian.net/browse/GROMO-2555) | 4개 JVM JSON → Fluent Bit → dev Loki 조회 | 2553·2554 | 2d | 스프린트 대기 |
| [2556](https://romance.atlassian.net/browse/GROMO-2556) | 시스템/Nginx 원본 → S3·장애 복구·컷오버 | 2555 | 2d | 스프린트 대기 |
| [2557](https://romance.atlassian.net/browse/GROMO-2557) | Outbox → Kafka/HTTP 소비·재시도 원인 연결 | 2555 | 2d | 스프린트 대기 |
| [2558](https://romance.atlassian.net/browse/GROMO-2558) | 여러 원사건 → 기기별 묶음 발송 연결 | 2557 | 1d | 스프린트 대기 |
| [2559](https://romance.atlassian.net/browse/GROMO-2559) | Realtime Redis 2개 채널·STOMP·구버전 호환 | 2555·2557 | 2d | 스프린트 대기 |
| [2560](https://romance.atlassian.net/browse/GROMO-2560) | 통합 조회·Athena·APM/지표 연결·운영 검증 | 2556·2558·2559 | 2d | 스프린트 대기 |

Jira에도 위 방향의 `Blocks` 링크를 등록했다. 2554는 실제 환경 접근·인프라 확인이 필요한 작업이고, 나머지는 로컬 구현·검증을 진행할 수 있다. 수집기 운영 활성화는 2554 결과를 먼저 확인한다.

기존 [790](https://romance.atlassian.net/browse/GROMO-790)은 user-activity Fluent Bit 전환, [924](https://romance.atlassian.net/browse/GROMO-924)는 Java S3 업로더 제안, [2288](https://romance.atlassian.net/browse/GROMO-2288)은 새 prod·호스트 업로더 구축이다. 2556과 관련 링크만 연결했으며 담당자·상태·범위를 바꾸지 않았다. 신규 수집은 `system_log/v2/`를 다루고, Java S3 업로더를 추가하지 않는다. 실제 컷오버에서 실행 중인 2288 업로더와 중복을 확인해야 한다.

## 2553에서 구현한 경로

1. Business `RequestEnvelopeFilter`가 생성한 ID를 `RequestLogContext`로 MDC `request_id`에 설치한다. 응답의 `X-Request-Id`와 같으며, 외부 동명 헤더를 채택하지 않는다.
2. `ScreenComposer`가 원래 사용하는 `UpstreamRequestContext.within`에 같은 scope를 적용한다. MDC 전체를 복사하지 않고 명시적인 context의 ID만 사용한다.
3. `InternalHttpClient`의 두 번째 worker도 `context.within` 안에서 실행한다. 같은 ID는 HTTP `X-Request-Id`로 전달된다. 기존 Future·queue·cancel/remove 구조를 유지한다.
4. Data `TraceIdFilter`는 `X-Request-Id`를 별도로 검증해 `request_id`에 넣는다. `X-Trace-Id → X-Request-Id → 생성` 순서의 기존 `trace_id` 호환 계약은 유지한다. ID는 `[A-Za-z0-9_-]{1,128}`로 제한한다.
5. Data는 본인이 소유한 `trace_id`·`request_id`·`user_id`의 이전 값만 복원한다. Business도 자신의 `request_id`만 복원한다. `MDC.clear()`로 tracer·다른 필터의 키를 삭제하지 않으며, `dd.*`를 부모 스레드에서 복사하지 않는다.
6. Business의 Boot Logback level 패턴과 Data의 기존 APP 콘솔/파일 패턴에 `[request_id=...]`를 넣는다. 원본 텍스트에서 이 값으로 두 서비스 로그를 모아 볼 수 있다.

Data에 `X-Request-Id`가 없으면 검증된 레거시 상관 ID를 fallback으로 사용한다. 헤더가 있지만 형식 검사를 통과하지 못하면 새 ID를 생성한다. **이 request ID와 기존 trace_id를 Datadog APM trace ID라고 해석하지 않는다.** 정규화된 APM JSON 필드는 2555 범위다.

최신 main에 `InternalCall`의 `X-Request-Id` 대소문자 무관 차단이 이미 있어 별도 구현은 하지 않았다. 회귀 테스트로 헤더 덮어쓰기를 확인한다. 같은 main에서 Data의 `/internal/*` 등록도 이미 적용되어 있어 등록 범위를 바꾸지 않았다.

## 검증 기록

- 실제 loopback HTTP 서버를 통한 요청 필터 → 조합 pool → HTTP pool 테스트: 서버 수신 헤더·응답 DTO·세 스레드의 로그 MDC가 같은 요청 ID인지 검증한다. 같은 pool을 두 요청이 재사용해도 새 ID가 적용된다.
- 중첩 scope·예외·재사용 thread: 이전 request ID와 context 복원, 다른 MDC 변경 보존, tracer/개인 키의 부모→worker 복사 없음.
- Data 필터: request ID와 레거시 trace ID가 다를 때 분리, 잘못된 문자·길이의 입력 거부, 사용자 없는 요청에서 상위 user_id 누출 방지, 예외 후 tracer·상위 문맥 보존.
- 기존 HTTP 실제 TCP 테스트: deadline·TLS 대기·본문 지연·취소·큐 포화·재시도·서킷 회복·예약 헤더 보호.

| 범위 | 실행 명령 | 결과 |
| --- | --- | --- |
| Business 전체 | `cd server/business-api && ./gradlew build --console=plain` | 성공. 테스트 2,196개, 실패·오류·skip 0. Checkstyle Main·SpotBugs Main·JAR 빌드 통과 |
| Data 필터 | `cd server/data-api && SPRING_PROFILES_ACTIVE=ci ./gradlew test --tests '*TraceIdFilterTest' checkstyleMain spotbugsMain --console=plain` | 성공. 필터 테스트 22개, 실패·오류·skip 0. Main 정적 검사 통과 |
| 문서·변경 | 상대 링크 존재 검사, `git diff --check` | 상대 링크 78개 정상, 공백 오류 없음 |

Business의 Checkstyle Test·SpotBugs Test는 저장소 설정에 따라 비활성이다. Data의 전체 DB 통합 테스트를 실행한 것으로 해석하지 않는다. 운영 로그 내용이나 자격증명을 테스트 fixture에 사용하지 않았다.

## 2555에서 구현한 경로

**JVM JSON 출력.** Business·Data·Notification·Realtime이 dev·prod(Data는 staging 포함) 콘솔에 `schema_version` 1 JSON 한 줄을 낸다. 서비스마다 둔 `ObservationJsonProvider`(Spring Boot `StructuredLogFormatter` + `JsonWriter`, 새 의존성 없음)가 형식을 만든다. Business·Notification·Realtime은 `logging.structured.format.console`, Data는 `logback-spring.xml`의 `CONSOLE_JSON`으로 켠다. local·ci·default 콘솔, Data `APP_FILE`·`UA_FILE`·user-activity, Business `logging.file.name` 파일은 컷오버 전까지 기존 텍스트 그대로다.

- provider는 로그 이벤트의 MDC 스냅샷만 읽고 정해진 키(`request_id`, `origin_*`, `user_id`, `event_id`, `delivery_id`, `attempt`, `operation_id`, `event_name`, `message_id`, `edge_request_id`)만 내보낸다. Data의 레거시 `trace_id`는 `legacy_trace_id`로 낸다.
- `dd.trace_id`·`dd.span_id` 원문은 `dd` 객체에 두고, 32자리 hex trace와 10진 span만 canonical `trace_id`(32 hex)·`span_id`(16 hex)로 바꾼다. 10진 trace는 상위 64비트를 잃었을 수 있어 canonical을 만들지 않는다. dd-trace 1.64.0은 128-bit 생성·로그가 기본 켜짐이라 이 서비스가 시작한 trace는 32 hex로 나온다(2557 조사). compose에 `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true`를 명시했다.
- message·exception은 Data `MaskingConverter`의 4규칙으로 마스킹한 뒤 16 KiB·32 KiB(UTF-8 문자 경계)로 자르고, 잘리면 `truncated`·`original_size_bytes`를 붙인다.
- Business 완료 로그는 `log_kind=access`와 `http_method`·`http_route`(경로 템플릿)·`status_code`·`duration_ms`·`outcome`을 구조화해 낸다. 예외가 필터 밖으로 나가 상태가 미확정이면 `status_code`를 빼고 `outcome=unhandled_exception`으로 낸다. query string·본문·헤더는 싣지 않는다.

**실행 메타데이터.** compose `environment:`에서 `OBS_SERVICE`(서비스 이름 고정)·`OBS_ENV`(`DEPLOY_ENV`)·`OBS_VERSION`(`IMAGE_REVISION`)을 넣는다. 비밀이 아니므로 Secrets Manager 경로를 쓰지 않는다. 배포 전 `deploy-core-dev.py`·`prepare-satellite-deploy.py`가 렌더 결과의 OBS 값이 서비스·환경·배포 커밋과 다르거나 비었으면 배포를 멈춘다. `OBS_VERSION`은 기존 `DD_VERSION`처럼 배포 커밋을 가리키므로 위성 한쪽만 바뀐 배포에서는 다른 쪽의 실제 이미지와 다를 수 있다. Catus prod 실행 구성은 Infra 저장소 소유라 이 저장소에서 넣지 못했다.

**수집기.** dev 관측 overlay의 Promtail을 Fluent Bit `4.2.8`(amd64·arm64)로 바꿨다. `/var/lib/docker/containers`를 읽기 전용으로 tail하고 tail DB와 filesystem 버퍼(`storage.total_limit_size 128M`)는 `fluent_bit_state` 볼륨에 둔다. Lua 필터가 `config.v2.json`의 compose 라벨로 project `phone`의 네 서비스만 통과시킨다. Loki label은 `env`·`service`·`log_kind`(`application`·`access`·`raw`) 셋이며 ID는 JSON 필드로 남는다. JSON이 아닌 줄은 버리지 않고 `parse_error=true`·`log_kind=raw`로 Lua 마스킹(ASCII 근사) 후 보관한다. Loki 연결 오류·5xx·429는 재시도하지만 4xx는 버리고, 버퍼가 차면 오래된 chunk부터 버린다. 무유실을 보장하지 않는다.

**검증.**

| 범위 | 명령 | 결과 |
| --- | --- | --- |
| 4개 JVM 전체 | 서비스마다 `SPRING_PROFILES_ACTIVE=ci ./gradlew build` | 모두 성공. business 2,216·notification 216·realtime 803·data 1,877(skip 1은 기존 `@Disabled`) 실패·오류 0 |
| 프로파일 기동 | 별도 JVM으로 실제 yml/xml을 로드 | dev·prod는 JSON 한 줄, ci는 텍스트 |
| 스레드 hop | 실제 `AsyncAppender` 아래에서 MDC를 바꾼 뒤 encode | 로그 시점의 `request_id`·`dd` 값 유지 |
| 배포 스크립트 | `python3 -m unittest discover -s .github/scripts` | 347개 통과 |
| 수집기 로컬 하네스 | `server/observability/fluent-bit/local-test/run.sh` | 500줄: 정상·Fluent Bit 재시작·컨테이너 재생성 모두 누락 0·중복 0, label 3개, 다른 project 미끼·자기 로그 재수집 0 |

dev Loki는 현재 떠 있지 않아(2554 조사표 `runtime-inventory.md`) dev 배포 경로에서는 검증하지 않았다. agent가 실제로 넣는 MDC 형식, 실배포 JSON 출력, prod 적용은 미검증이다.

## 2557에서 구현한 경로

**Outbox 원인 문맥 저장.** Data가 Outbox 행을 쓸 때(append) origin을 캡처해 `event_outbox.origin_request_id`·`origin_trace_id` 열(Data Flyway V4, 추가 전용 nullable)에 저장한다. 이미 MDC에 origin이 있으면 그 쌍을 우선하고, 없을 때만 현재 요청 ID와 tracer API(`CorrelationIdentifier`)의 trace 원문을 쓴다. 캡처에 실패하면 origin 없이 접고 업무 쓰기는 그대로 진행한다. 재시도는 저장된 값을 읽기만 한다.

**Relay 전달.** relay는 전달 행마다 로그 scope(`event_id`·origin·`delivery_id`·`attempt`)를 열고 닫으며 `event_name=outbox.delivery` INFO 한 줄로 결과를 남긴다. relay 풀 스레드의 MDC는 scope 밖에서 비어 있고, 스레드 사이로 MDC를 복사하지 않는다. carrier 생성·scope 열기·결과 로그 실패는 전달·재시도·DLT 판정을 바꾸지 않는다. carrier 생성이 실패하면 origin 헤더 없이, scope만 실패하면 헤더는 유지하고 로그 문맥 없이 전달한다.

**헤더 이름.** Kafka는 `x-origin-trace-id`·`x-origin-request-id` 등 소문자 `x-*`, HTTP는 `X-Origin-Trace-Id`·`X-Origin-Request-Id`·`X-Delivery-Id`·`X-Attempt`·`X-Trace-Context-Version`(상수 `1`)이다. 도메인 이벤트 봉투·Kafka key·`envelope_hash` 대상 본문·멱등 키는 바꾸지 않는다.

**Notification 수신.** 수신 경로가 헤더를 검증해 scope를 열고(`event_name=consumer.accept`), 값을 `deliveries`의 origin 열(Notification V14)에 저장해 이후 발송 로그가 같은 origin을 단다. 같은 이벤트를 재전달해도 저장된 origin·본문 해시는 바뀌지 않고, DLT로 보낼 때 추적 헤더를 유지한다. 형식이 틀린 칸은 버리고 모르는 버전은 문맥 없음으로 처리하며 수신·DLT 판정은 그대로다.

**trace 표기(dd-trace 1.64.0).** 128-bit trace 생성·로그 출력이 기본 켜짐이라 이 서비스가 시작한 trace는 32 hex로 저장된다. 상위 64비트가 0이면 10진 표기가 되고, trace가 없으면 `"0"`을 저장하지 않는다.

**검증.**

| 범위 | 결과 |
| --- | --- |
| data-api 전체 | 1,887개 실패·오류 0 (2555 병합 트리 기준) |
| notification 전체 | 221개 실패·오류 0 |
| 로그 JSON | 렌더링된 JSON의 키를 단언 |
| relay 풀 MDC | scope 밖에서 비어 있음을 단언 |
| Data V4 롤백 | 이전 번들로 migrate·validate가 통과하는지 테스트 |

**이 PR 범위 밖·후속.**

1. 멱등 재요청 로그에 `event_id`·기존 origin 기록(설계 §3.1, 구현 계획 V18).
2. Data `/internal/*` 수신의 `X-Origin-*` 채택. 지금은 Data 내부 HTTP 수신에서 새 Outbox를 쓰면 origin이 그 요청의 `request_id`가 되어 T1→T2→T3 origin 유지가 닫히지 않는다.
3. 불량 carrier 진단 카운터. 지금은 조용히 버린다.
4. 공통 내부 HTTP client(Business `InternalHttpClient` 등)의 origin 헤더 전파. Outbox HTTP transport에만 적용했다.

**dev 배포 뒤 확인.** agent 활성 상태에서 `origin_trace_id` 원문 형식, agent 자동 헤더(`traceparent` 등)와 `x-origin-*`의 공존.

## 2559에서 구현한 경로

**내부 wire.** `chat:fanout`의 `ChatFanoutEvent`와 `chat:events:v1`의 `RealtimeEventFanoutEvent`에 nullable `telemetry {v, originRequestId, originTraceId, eventId}`(`@JsonInclude(NON_NULL)`)를 더했다. `v`는 boxed `Integer`다. 클라이언트 DTO(`ChatMessageResponse`)와 7필드 이벤트 봉투에는 추가하지 않는다. 받는 쪽은 전용 lenient 역직렬화기(`FanoutTelemetry.Lenient`)로 읽는다. 객체가 아니거나 한 필드라도 타입이 어긋나면 telemetry **전체**를 버리고 봉투는 그대로 처리한다. 필드 단위로 살리지 않는 이유는 깨진 발행자가 낸 나머지 값을 원인으로 믿으면 엉뚱한 요청에 로그가 이어질 수 있기 때문이다.

**발행.** 발행 직전 현재 스레드 MDC에서 telemetry를 만든다(`FanoutTelemetry.capture`). origin 키가 하나라도 있으면 그대로 싣고, 없을 때만 `request_id`를 origin으로 승격한다. 채팅(`chat:fanout`)은 `eventId`를 비우고 `message_id`로 잇는다. 도메인 사건은 봉투의 `eventId`를 싣는다. 세션 폐기 제어 사건도 같은 `chat:events:v1` 채널을 쓰며 Data 사건 id를 telemetry `eventId`로 싣는다. 발행마다 `event_name=fanout.publish` INFO 한 줄을 남긴다. 이 줄은 «Pub/Sub에 넘겼다»이지 «건너편이 받았다»가 아니다.

**구독.** 두 subscriber는 역직렬화 성공 직후, 자기 echo 판정 **전**에 scope를 연다. `self_echo` 줄도 원인과 ID를 단다. scope에는 telemetry 값과 채팅의 `message_id`, 사건의 봉투 `eventId`를 넣고 `finally`에서 이전 값으로 되돌린다. 결과는 `event_name=fanout.receive` 한 줄(`result=delivered|self_echo|invalid|failed`)이다. 역직렬화 자체가 실패한 `invalid` 줄은 scope가 없다. 섬 사건 subscriber에서 제어 필드도 섬 사건 필드도 갖추지 못한 봉투를 버릴 때의 `invalid`는 scope 안에서 나온다. 실패 로그는 예외 클래스 이름만 남기고 본문 조각을 싣지 않는다.

**아웃바운드.** `OutboundSendBudget`의 TaskDecorator가 «세션별 개수 세기»와 «앱 MDC 스냅샷 설치·복원»을 함께 한다. 제출 시점에 `request_id`·`origin_*`·`event_id`·`message_id` 등 allowlist 키를 캡처해 `realtime-outbound-*` 스레드에 설치하고 닫을 때 실행 스레드의 원래 값으로 되돌린다. `user_id`는 옮기지 않는다. 아웃바운드의 현재 사용자는 수신 세션인데 발신자 id가 붙으면 수신자별 판정 로그와 섞이기 때문이다. `event_name`·`dd.*`·`trace_id`·`span_id`도 옮기지 않는다. 이 연결은 `configureBrokerChannel`에 executor가 없다(동기)는 전제 위에 있다. executor를 주면 제출 스레드의 MDC 캡처가 끊긴다. `WebSocketConfigTest`가 이 전제(`hasExecutor` false)를 고정한다.

**STOMP 수신 프레임.** 수신 인터셉터 맨 앞의 `StompLogScope`가 프레임마다 새 `request_id`와 인증 주체 `user_id`를 `beforeHandle`~`afterMessageHandled` 동안 설치하고 복원한다. 채팅 발신이 내는 팬아웃의 origin은 이 `request_id`다. 순서 보존 콜백이 같은 스레드에서 다음 프레임의 `preSend`를 부르는 구간에는 두 키를 내려 둔다. 그래서 `preSend`~`afterSendCompletion` 구간에서 나오는 거절 로그(ERROR 프레임)에는 `request_id`가 없다. 프레임을 버리지 않으며 거절 판정은 기존 인터셉터 그대로다(`StompLogScopeTest`).

**수신 입구.** `KafkaEventInbound`는 `ConsumerRecord` 헤더를, `/internal/events`·우체통은 인증을 통과한 요청의 헤더를 처리 동안 설치한다(형식 오류·모르는 버전은 무시). HTTP·Kafka 공통 `InboundAcceptLog`가 `event_name=consumer.accept` 한 줄(`accepted|duplicate|failed`)을 남긴다. 본문 처리·dedupe·재시도·DLT 판정은 바꾸지 않는다.

**혼합 배포.** 순서 제약이 없다. 구버전 인스턴스는 모르는 `telemetry` 키를 무시하고(Jackson 3 `FAIL_ON_UNKNOWN_PROPERTIES` 기본값 false), 새 인스턴스는 키 없는 구버전 JSON을 `telemetry=null`로 읽는다. `InboundEventServiceTest`의 `oldReplicasReadTelemetryWireWithoutFailing`(신→구)과 `newReplicasReadPreTelemetryWire`(구→신)가 실제 ObjectMapper로 양방향을 확인한다.

**검증.**

| 범위 | 결과 |
| --- | --- |
| realtime 전체 `build` (로컬 실행, 2557 병합 트리) | 824개 실패·오류 0 |
| 두 인스턴스 `FanoutLogContextIntegrationTest` (같은 JVM 두 컨텍스트, 실제 Redis·Postgres) | STOMP 프레임 `request_id`가 팬아웃 origin이 됨, 두 채널의 구독·아웃바운드 MDC 연결, 자기 echo, 클라이언트 원문 키 불변, 손상 telemetry가 업무 전달을 막지 않음 |

위 숫자는 로컬 실행 결과다. dev 배포 검증이 아니다.

**2559 범위 밖·후속.**

1. `chat:sea:v1`(`SeaRoomFanoutEvent`)과 이동 채널은 wire에 telemetry를 싣지 않았다. 바다 방 사건은 `message_id` 조회에 잡히지 않는다.
2. Redis 메시지 처리 span은 만들지 않았다. 이번 범위는 앱 ID scope뿐이다.
3. subscriber 단절을 구분하는 로그는 없다(`implementation-details.md` §5 완료 조건 중 후속). 역직렬화 실패만 `invalid`로 구분한다.
4. Kafka 재시도·DLT recoverer 로그는 scope 밖이다.
5. 미검증: Realtime Kafka 실제 브로커, DLT 헤더 보존(리스너를 `ConsumerRecord`로 직접 호출해 검증), 실배포 JSON 출력.

## 아직 구현하지 않은 경계

- 이 첫 티켓은 요청 ID의 동기 HTTP 경로를 연결한다. Preview worker와 Notification 묶음 전송은 후속 범위다. Outbox 영속 carrier와 Kafka 소비는 2557, Realtime Redis 두 채널(`chat:fanout`·`chat:events:v1`)과 STOMP 프레임 scope는 2559에서 구현했다. Realtime에서 남은 것은 아래 「2559 범위 밖·후속」에 적었다.
- Data 인증 실패는 TraceIdFilter 앞에서 끝나므로 이번 구현만으로 Data의 모든 401/403 로그에 요청 ID가 생기지 않는다. 인증 이전 scope·인증 이후 사용자 보강은 2555 범위(JSON 출력)에 넣지 않았다 — 후속 과제다. Business의 error/async dispatch 최종 상태도 2555는 미처리 예외만 `outcome=unhandled_exception`으로 구분하고 error dispatch 재진입은 다루지 않는다.
- 2553 시점의 Business access log는 미처리 예외 최종 상태를 구분하지 않았다. 2555부터 미처리 예외는 `status_code` 없이 `outcome=unhandled_exception`으로 남는다.
- DD agent 활성 상태의 span 전파, sample 미보관 시 조회, 로그 JSON·마스킹·log_id, Loki/S3 수집·재전송·중복 제거·보존·부하 영향은 아직 미검증이다.
- 구현 기준 main에서 Data의 `AsyncConfig`·`NotificationAsyncConfig`는 삭제됐다. 초기 계획의 레거시 GA4/push executor를 복원하지 않는다.
- Infra 정본은 2288에서 확인한 `OneOrThree/Infra`다. 실제 수집 설정·운영 버전은 2554에서 재확인한다.

## epic-batch 실행

사용자가 `/epic-batch`를 명시 호출했다. 기준 스킬은 `~/.claude/skills/epic-batch/SKILL.md`와 그 선행 `parallel/SKILL.md`다.

- 에픽 통합 브랜치: `feat/GROMO-2562-log-observability`, 기준 `origin/main`.
- 기존 2553 브랜치를 첫 하위 PR로 재사용한다. 이후 파일 충돌 경계별 체인에서 티켓별 PR을 쌓는다.
- 기본 모드로 실행하며 `--merge-sub`는 지정하지 않았다. 사용자 머지 뒤 통합 PR을 main에 준비한다.
- 조정자는 계약·브리프·검증·git·PR·리뷰를 맡고, 구현은 Claude 하위 에이전트에 배분한다.
- 운영 환경 조사·자격 접근 불가 항목은 증거와 함께 미검증으로 남긴다. 실제 서비스 재시작·배포·Terraform apply는 이번 실행에 포함하지 않는다.
- 설계·진행·검증은 이 `docs/architecture/server-log-observability/`에 계속 남긴다. 개인 작업 브리프·세션 기록만 gitignored `doc/`를 쓴다.
