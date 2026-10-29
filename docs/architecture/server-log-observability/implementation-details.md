# Logback 설정·스레드 추적·로그 연결 상세

> 2026-10-29 보강. **목표 설계와 예시**다. 2555에서 JSON provider를 구현했다(Spring Boot 내장 `StructuredLogFormatter`+`JsonWriter`). 범용 decorator는 만들지 않았고 경계마다 명시 scope를 둔다. 요청 ID scope(2553)와 JSON 출력(2555)의 구현 범위는 [구현 현황](implementation-status.md)에 명시한다. 기준 커밋은 상위 [아키텍처](README.md)와 같다.

핵심은 **로그 발생 시점에 문맥을 붙이고, 스레드·프로세스 경계에서는 문맥을 전달하며, 조회할 때 공통 ID로 이벤트를 모으는 것**이다. thread 이름이나 발생 시각으로 요청을 추측하지 않는다.

## 1. Logback을 어떻게 설정하나

### 1.1 출력 책임

| 계층 | 구현할 일 |
| --- | --- |
| 요청 필터·작업 scope | `request_id`, `origin_request_id`, 인증된 `user_id`, `event_id`, `origin_trace_id`, `delivery_id`, `attempt`, `operation_id`, `message_id`, `edge_request_id`를 적용하고 종료 시 복원 |
| Datadog tracer | 실제 HTTP·executor·Kafka trace/span 생성·전파, 로그 이벤트에 DD ID 주입 |
| Logback JSON provider | 로그 이벤트의 MDC snapshot에서 ID를 읽고 공통 JSON 생성, log ID 부여, message/exception/추가 필드 마스킹 |
| Fluent Bit | JSON 파싱, 최초 수집 시각·컨테이너 메타데이터 보강, **같은 log ID와 문맥을 유지**하며 Loki/S3에 전송 |

현재 네 서비스 Dockerfile은 DD Java agent `1.64.0`을 지정한다. 배포된 이미지가 그 버전이라는 뜻은 아니므로 P0에서 실배포를 확인한다.

### 1.2 구현한 구성과 채택하지 않은 대안

**구현 (2555).** 네 서비스 모두 Spring Boot `4.0.6` 내장 `StructuredLogFormatter`와 `JsonWriter`로 JSON 한 줄을 만든다. 서비스마다 `ObservationJsonProvider`를 자기 패키지에 둔다(서비스 간 공유 코드 없음).

- Business·Notification·Realtime: `application-{dev,prod}.yml`의 `logging.structured.format.console`로 켠다.
- Data: `logback-spring.xml`의 `CONSOLE_JSON` appender와 `StructuredLogEncoder`로 켠다(dev·staging·prod 프로파일). `APP_FILE`·`UA_FILE`·user-activity 경로는 텍스트 그대로다.
- local·ci·default 프로파일 콘솔은 사람이 읽는 텍스트를 유지한다.

선택 이유: Boot 4.0.6에 이미 들어 있어 **새 의존성이 없다.** Data만 Jackson 2를 쓰는 조합이라 서비스마다 다르게 맞춰야 하는 부담도 피했다. 초기 console은 기존처럼 동기 출력이며 AsyncAppender는 도입하지 않았다. 범용 decorator도 만들지 않고, 스레드 hop은 지금처럼 경계마다 명시 scope로 넘긴다.

**채택하지 않은 대안.** 초기 설계에서는 `logstash-logback-encoder`의 `LoggingEventCompositeJsonEncoder`와 별도 `observability-appender.xml`(`APP_JSON`)을 제안했다. 새 의존성이 필요하고 Data의 Jackson 조합을 따로 맞춰야 해서 쓰지 않았다. 아래 XML은 그 대안의 모양을 보존한 것이며 **현재 코드에는 없다.**

```xml
<included>
    <appender name="APP_JSON" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LoggingEventCompositeJsonEncoder">
            <providers>
                <timestamp>
                    <fieldName>timestamp</fieldName>
                    <timeZone>UTC</timeZone>
                </timestamp>
                <logLevel><fieldName>level</fieldName></logLevel>
                <loggerName><fieldName>logger</fieldName></loggerName>
                <threadName><fieldName>thread</fieldName></threadName>
                <pattern>
                    <pattern>
                        {"schema_version":1,
                         "service":"${OBS_SERVICE}",
                         "env":"${OBS_ENV}",
                         "instance_id":"${HOSTNAME:-unknown}",
                         "version":"${OBS_VERSION}"}
                    </pattern>
                </pattern>
                <provider class="com.oneorthree.phone.common.logging.ObservationJsonProvider"/>
            </providers>
        </encoder>
    </appender>
</included>
```

```xml
<springProfile name="dev | staging | prod">
    <include resource="observability-appender.xml"/>
    <root level="INFO">
        <appender-ref ref="APP_JSON"/>
    </root>
</springProfile>
```

기존 APP 파일은 컷오버 전까지 텍스트로 유지하고 Fluent Bit은 stdout만 읽는다. 파일 출력 제거와 기존 호스트 타이머의 APP 적재 중단·보존 정책은 컷오버(2556)에서 함께 정한다. user-activity 업로더까지 함께 중단하지 않는다. 향후 AsyncAppender가 필요해지면 queue·discard·종료 drain·drop 계측을 별도 설계하고 이벤트 snapshot 테스트를 통과시킨다.

**실행 메타데이터.** 호스트의 compose 치환용 `DEPLOY_ENV`·`IMAGE_REVISION`은 자동으로 JVM 환경변수가 되지 않으므로 compose `environment:`에 `OBS_SERVICE`(서비스 이름 고정)·`OBS_ENV`·`OBS_VERSION`을 명시한다. provider는 이 값을 로그 패턴 치환이 아니라 Spring `Environment`에서 읽는다. **형식이 틀리면 그 필드를 조용히 생략한다**(`putRuntime`). 그래서 생략이 운영에서 드러나지 않도록 배포 전 검사(`deploy-core-dev.py`·`prepare-satellite-deploy.py`)가 렌더 결과의 OBS 값이 서비스·환경·배포 커밋과 다르거나 비면 배포를 막는다. 이 검사는 `docker compose config` 렌더 결과만 본다. **실제 컨테이너가 출력한 JSON의 service/env/version 확인은 아직 하지 않았다**(후속, 2556·2560). `DD_SERVICE`의 `gromo-back-prod` 등과 로그의 `data-api` 명칭은 별도 매핑표로 관리하고, APM 링크에 로그 service 이름을 그대로 넣지 않는다. prod(Catus) 실행 구성은 Infra 저장소 소유라 이 저장소에서 넣지 못했다.

### 1.3 ObservationJsonProvider 구현 계약

provider가 출력하는 필드는 `log_id`, `log_kind`, `message`, `exception`, 실제 trace/span, allowlist MDC, 허용된 접근 로그 필드다. stock `<message/>`, `<stackTrace/>`, `<mdc/>`, `<arguments/>`를 동시에 추가해 같은 필드를 중복 출력하거나 미검사 필드를 우회 노출하지 않는다.

1. `ILoggingEvent.getMDCPropertyMap()`에서 **이벤트의 문맥**을 읽는다. provider 실행 스레드의 `MDC.get()` 또는 `CorrelationIdentifier.getTraceId()`로 현재 값을 읽지 않는다.
2. `dd.trace_id`·`dd.span_id` 원문을 문자열로 유지하고 동일 ID의 canonical `trace_id`·`span_id`를 출력한다. canonical은 `TraceIds`가 한 곳에서 만든다. 기존 앱 UUID `trace_id`는 정규화 입력으로 사용하지 않는다(`legacy_trace_id`로 낸다). 실제 ID를 해석할 수 없으면 DD 원문만 보존하고 canonical 필드를 생략한다. **해석 실패의 «오류 계측»은 구현하지 않았다**(후속).
3. 앱 MDC는 위 출력 책임 표의 ID allowlist만 허용한다. `attempt`, `status_code`, `duration_ms`는 검증 후 JSON 숫자로 출력한다. `event_name`은 `operation.link` 등 사전 정의 값만 구조화 필드로 허용한다. 임의 MDC 전체와 임의 structured argument를 덤프하지 않는다.
4. `log_kind`는 허용된 접근 로그 이벤트면 `access`, 나머지는 `application`. 접근 로그의 method/route/status/duration은 검증된 구조화 필드로 전달한다. `ThreadLocal` 숫자를 message 정규식에서 추출하지 않는다.
5. 로그 한 건마다 UUID `log_id`를 생성한다. 실제 수집되는 APP encoder는 하나로 유지해 Loki·S3에는 같은 ID가 전달된다. 로그 재수집 시 Fluent Bit이 새 ID를 만들지 않는다. **JSON이 아니어서 `parse_error=true`로 보관되는 raw 줄에는 `log_id`가 없다.** 이 줄은 Loki의 «같은 시각·같은 줄» 중복 제거와 `observed_at`에 기대며, 재읽기로 중복이 생길 수 있다는 한계가 있다. 향후 여러 직접 출력으로 분기하면 encoder마다 UUID를 만들지 말고 분기 전 이벤트에 한 번만 부여한다.
6. `event.getFormattedMessage()`와 exception proxy에서 message/stack을 얻어 마스킹·크기 제한 후 출력한다. 원본이 한도의 2배를 넘으면 마스킹 전에 문자 경계에서 먼저 잘라 마스킹 비용을 출력 상한에 묶고, 마스킹 뒤 다시 한도로 자른다. 마스킹 정규식은 입력 길이에 선형이어야 한다(긴 영숫자 줄에서 동기 콘솔 로깅을 막지 않게). 제한 시 `truncated=true`, `original_size_bytes`를 추가한다. stack의 줄바꿈은 JSON 안에 escape한다. 기존 `%mask` 패턴 변환기를 JSON 전환 후 자동으로 적용된다고 가정하지 않는다.
7. agent 미활성·기동 로그는 trace 없이도 정상 출력한다. provider 오류·드롭 계측에서 같은 logger를 재귀 호출하지 않는다.

DD `1.64.0`은 로그 발생 시점의 span context를 `ILoggingEvent`와 연결하고 `getMDCPropertyMap()` 결과에 ID를 합친다. 따라서 AsyncAppender를 나중에 사용해도 이 **이벤트 기준 조회**가 중요하다. [로그 발생 계측 소스](https://github.com/DataDog/dd-trace-java/blob/v1.64.0/dd-java-agent/instrumentation/logback-1.0/src/main/java/datadog/trace/instrumentation/logback/LogbackLoggerInstrumentation.java), [이벤트 MDC 계측 소스](https://github.com/DataDog/dd-trace-java/blob/v1.64.0/dd-java-agent/instrumentation/logback-1.0/src/main/java/datadog/trace/instrumentation/logback/LoggingEventInstrumentation.java)

정규화는 표기만 바꾸며 식별자를 새로 만들지 않는다. **32자리 hex trace만 canonical `trace_id`가 된다**(소문자로 그대로). 10진 trace는 128-bit 생성 중 상위 64비트를 잃었을 수 있어 canonical을 만들지 않고 `dd` 원문만 낸다. span은 unsigned 10진 문자열을 16자리 hex로 변환한다. compose에는 `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true`를 명시했고, 실제 적용은 dev 배포 뒤 검증 항목이다. trace/span이 `0`이면 활성 trace가 없는 것으로 처리한다. **128-bit 생성 중 로그 옵션이 꺼져 하위 64비트만 남은 값은 전체 ID로 복원할 수 없다.** 그 상태에서는 canonical trace를 추측하지 않고 DD 원문만 보존한다(P0 실패 판정 자동화는 후속). [DD ID 생성·출력 소스](https://github.com/DataDog/dd-trace-java/blob/v1.64.0/dd-trace-core/src/main/java/datadog/trace/core/CoreTracer.java)

## 2. 스레드가 다른데 어떻게 추적하나

**스레드 ID는 진단 정보이고, 추적 키는 trace/request/event ID다.** 한 스레드는 여러 요청에 재사용되고 한 요청은 여러 스레드에서 실행될 수 있다. MDC는 작업 제출 시 자동으로 복사되지 않는다([Logback MDC 문서](https://logback.qos.ch/manual/mdc.html)).

전달할 문맥은 두 종류다.

- **tracer context:** trace/span·sampling 등. agent가 지원하는 executor/HTTP/Kafka 경계에서 전달한다. ID 문자열을 MDC에 복사하는 것만으로는 실제 APM 문맥이나 HTTP 헤더가 전달되지 않는다.
- **앱 MDC:** request/event/user 같은 운영 검색 키. allowlist snapshot을 작업 제출 시 캡처하고 실행 구간에만 설치한 뒤 기존 값을 복원한다. tracer 소유 `dd.*`, `trace_id`, `span_id`를 복사해 자식 span을 부모 span ID로 덮어쓰지 않는다.

### 2.1 코드에서 확인한 경계와 적용 위치

| 경계 | 현재 위치 | 적용 방법 |
| --- | --- | --- |
| HTTP 수신 thread | Business `RequestEnvelopeFilter`, Data `FilterConfig`/`TraceIdFilter` | agent server span + request ID scope. 인증 전 초기화, 인증 후 user 보강 |
| Business 화면 조합 pool | [ScreenComposer](../../../server/business-api/src/main/java/com/oneorthree/business/common/http/ScreenComposer.java) | 2553: 이미 명시 전달하는 `UpstreamRequestContext.within`에 request ID scope 적용. FutureTask를 추가 wrapper로 감싸지 않아 cancel/remove 의미 유지. agent executor 전파 실측은 후속 |
| Business 내부 HTTP pool | [InternalHttpClient](../../../server/business-api/src/main/java/com/oneorthree/business/common/http/InternalHttpClient.java) | 2553: HTTP worker도 `context.within`으로 실행해 같은 request ID 설치·복원. outbound client span의 헤더 전파 실측은 후속 |
| Business preview worker | [PreviewService](../../../server/business-api/src/main/java/com/oneorthree/business/linkpreview/service/PreviewService.java) | 제출 시 snapshot과 요청 번호 유지. 장시간 후 실행이면 원인 ID와 작업 trace 분리 |
| Data 레거시 `@Async` | 초기 조사에 있던 `AsyncConfig`·`NotificationAsyncConfig`는 구현 기준 main에서 삭제됨 | 삭제된 GA4/push executor를 복원하지 않는다. 현재 Outbox scheduler/transport 및 남은 비동기 경계를 대상으로 구현한다 |
| Outbox scheduler | [OutboxRelayService](../../../server/data-api/src/main/java/com/oneorthree/phone/outbox/service/OutboxRelayService.java) | thread snapshot으로 넘길 수 없음. DB에 원인 문맥 저장 후 전달 행마다 복원하고 새 시도 trace 생성 |
| Kafka consumer | Notification/Realtime listener | agent Kafka header 추출 + 이벤트 metadata scope. DLT/재시도 로그까지 적용 |
| Realtime 메시지 실행 | STOMP inbound/outbound executor와 처리 interceptor | 메시지마다 문맥 설치·복원. session 전체를 한 trace로 고정하지 않음. 실제 handler 실행 thread에서 적용 |
| Realtime 인스턴스 간 전달 | [RedisConfig](../../../server/realtime/src/main/java/com/oneorthree/realtime/config/RedisConfig.java), `ChatFanoutSubscriber`, `RealtimeEventFanoutSubscriber`, `SeaRoomPublisher`, `MovementCluster`(명령) | Redis 내부 wire에 nullable telemetry metadata 추가. subscriber thread에서 복원. 채팅은 `message_id`, 도메인·바다 방 사건은 `event_id`로 연결 |
| Logback 출력 thread | JSON provider 및 선택적 async appender | 실행 thread의 ThreadLocal을 조회하지 않고 `ILoggingEvent` snapshot 사용 |

Realtime 구현의 제약(2559·2581):

- 아웃바운드 스냅샷은 `user_id`를 옮기지 않는다. 그 스레드의 현재 사용자는 수신 세션이라 발신자 id가 붙으면 수신자별 판정 로그와 섞인다. 아래 2.2의 `KEYS` 예시를 그대로 복사하지 않는다.
- STOMP 아웃바운드 연결은 `configureBrokerChannel`에 executor가 없다(동기)는 전제 위에 있다. executor를 주면 제출 스레드의 MDC 캡처가 끊긴다. `WebSocketConfigTest`가 이 전제를 고정한다.
- STOMP 프레임 scope는 관문(`preSend`~`afterSendCompletion`)과 처리(`beforeHandle`~`afterMessageHandled`) 둘 다 연다(2581). 관문 거절(ERROR 프레임) 로그와 ERROR 프레임을 넘기는 아웃바운드 작업도 그 프레임의 `request_id`를 단다. 관문에서 만든 값은 내부 헤더(`realtimeLogRequestId`, STOMP native 헤더가 아니다)로 처리 단계에 넘겨 한 프레임이 한 값을 쓴다. 헤더를 달 수 없는 불변 메시지면 처리 단계가 새 값을 만든다.
- Realtime 내부 HTTP(`/internal/*`)는 토큰 관문을 통과한 요청에만 `request_id`를 설치·복원한다(`InternalServiceTokenFilter`, 2581). 호출자 `X-Request-Id`가 Data `TraceIdFilter`와 같은 형식(`[A-Za-z0-9_-]{1,128}`, 앞뒤 공백 제거)이면 그 값, 아니면 새 UUID다. 원인 헤더(`X-Origin-*`)는 종전대로 각 컨트롤러가 연다.
- 이동 길잡이(`MovementCluster`)·재검사 스케줄러(`MovementSubscriptionListener`)는 직접 만든 실행기라 TaskDecorator가 닿지 않는다. 작업을 넣을 때 `LogContext.carrying`으로 전달 키를 싣고 실행 스레드에서 설치·복원한다(2581).
- Kafka 재시도·DLT 판정은 리스너 scope 밖(오류 처리기)이다. 실패한 레코드의 같은 헤더로 다시 연다 — DLT 발행기를 감싼 scope 안에서 발행기 자신의 로그가, `RetryListener`의 `Kafka 사건 처리 실패`(시도마다, `deliveryAttempt`)·`재시도 소진 — DLT 로 보냈다`·`DLT 발행 실패` 줄이 같은 `event_id`·origin을 단다(2581). DLT 발행이 비동기로 실패하면 발행기의 `Dead-letter publication ... failed` 줄은 producer 스레드의 완료 콜백에서 나온다. 발행기에 넘기는 `KafkaOperations`가 `send` 결과 future를 보낸 스레드의 문맥을 깐 채 완료되는 새 future로 바꿔 돌려주므로 그 줄도 같은 문맥을 달고, 콜백이 끝나면 producer 스레드 값으로 되돌린다(2581 r1, `InboundEventServiceTest.asyncDeadLetterFailureLogCarriesTheRecordContext`). 재시도 횟수·DLT 판정·발행 실패를 성공으로 삼키지 않는 동작은 그대로다. `event_id`는 `x-event-id` 헤더 값이다(본문을 다시 읽지 않는다). Spring 컨테이너 자신의 `Record in retry and not yet recovered` 줄은 이 scope 밖이다.

`ScreenComposer`와 `InternalHttpClient`는 Spring `ThreadPoolTaskExecutor`가 아니므로 **TaskDecorator 빈 하나를 등록하는 것만으로 처리되지 않는다**. 직접 만든 pool의 submission wrapper도 수정해야 한다. future 완료 callback·`thenApplyAsync`는 callback 등록과 executor 제출 시점이 다를 수 있다. 이 경우 등록 시 앱 문맥을 캡처한 callback wrapper가 실행 본문에서 그 값을 설치·복원해야 한다. 완료를 알린 다른 요청의 thread 문맥을 실수로 물려받지 않게 검사한다.

### 2.2 앱 MDC 전달 코드 예시

아래는 앱 MDC용 `TaskDecorator` 구현 형태다. tracer는 기존 agent가 맡는다는 전제이며, 이 코드만으로 trace 전파를 완료했다고 판정하지 않는다. 기존 pool 크기·거절 정책·Future 취소 동작을 바꾸지 않는다.

```java
public final class AppMdcTaskDecorator implements TaskDecorator {
    private static final List<String> KEYS = List.of(
            "request_id", "origin_request_id", "user_id", "event_id",
            "origin_trace_id", "delivery_id", "attempt", "operation_id",
            "message_id", "edge_request_id");

    @Override
    public Runnable decorate(Runnable task) {
        Map<String, String> submitted = capture(); // 제출 thread에서 실행
        return () -> {
            Map<String, String> previous = capture(); // 실행 thread 기존 앱 문맥
            install(submitted);
            try {
                task.run();
            } finally {
                install(previous); // 중첩 실행·CallerRunsPolicy도 원래 문맥 복원
            }
        };
    }

    private static Map<String, String> capture() {
        Map<String, String> values = new HashMap<>();
        for (String key : KEYS) {
            String value = MDC.get(key);
            if (value != null) values.put(key, value);
        }
        return Map.copyOf(values);
    }

    private static void install(Map<String, String> values) {
        for (String key : KEYS) {
            String value = values.get(key);
            if (value == null) MDC.remove(key);
            else MDC.put(key, value);
        }
    }
}
```

imports는 `java.util.*`, `org.slf4j.MDC`, `org.springframework.core.task.TaskDecorator`다. `ThreadPoolTaskExecutor`에는 초기화 전에 `setTaskDecorator(...)`를 적용한다. raw pool은 동일한 scope 처리를 `Runnable`/`Callable` 제출 wrapper에 적용한다. `FutureTask`를 쓰는 기존 코드는 callable 본문을 감싸고 기존 future/cancel 핸들을 유지해야 한다. 제출 거절 시 snapshot은 단순 값이므로 별도 활성 scope를 남기지 않는다.

`FutureTask` 내부 예외는 `run()` 밖으로 던져지지 않을 수 있어 decorator의 `catch`만으로 모든 실패를 기록할 수 없다. 기존 결과 수거·callback·예외 처리 경계에서 실패 로그를 남긴다. [Spring TaskDecorator 계약](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/TaskDecorator.html)

agent가 특정 executor를 지원하지 않으면 해당 경계에만 tracer의 공개 continuation/scope API를 적용한다. capture→실행 시 activate→finally close, 실행되지 않은 continuation의 cancel까지 구현한다. **이미 자동 전파되는 경계에 수동 wrapper를 중복 도입하지 않는다.** 이 결정은 agent `1.64.0`과 실제 executor를 사용한 검증 결과에 따른다.

### 2.3 thread와 trace가 연결되는 예

```text
Business / http-17          trace=T1  span=B1  request=R1
  → screen-composition      trace=T1  현재 문맥 유지, 필요 시 작업 span
    → internal-http-worker  trace=T1  outbound span=B2
      -- traceparent(T1,B2), X-Request-Id=R1 -->
Data / http-9               trace=T1  server span=D1  request=R1
  → DB commit + Outbox(E1, origin=T1, request=R1)
      [프로세스 재시작·시간 지연 가능]
Data / scheduler-1          trace=T2  span=R2  event=E1  origin=T1
  -- Kafka headers + event metadata -->
Notification / kafka-0      trace=T2  span=N1  event=E1  origin=T1
  → 발송 작업 DB에 E1/origin=T1 저장
Notification / sender-3     trace=T3  span=N2  event=E1  origin=T1
```

`T1` 등은 설명용 기호이며 실제 형식은 32자리 hex다. thread hop만으로 반드시 새 span을 만들 필요는 없다. 별도의 처리 시간 구간이 필요한 작업만 child span으로 계측하고, 자동 HTTP/DB span을 중복 생성하지 않는다.

## 3. 다른 프로세스·저장 경계에는 무엇을 싣나

| 운반 수단 | 담을 값 | 복원 책임 |
| --- | --- | --- |
| 내부 HTTP | tracer가 넣은 `traceparent`/`tracestate` 및 호환 DD headers, `X-Request-Id`, `X-Origin-Trace-Id`, `X-Origin-Request-Id`; 작업 호출은 허용된 event/delivery/operation ID headers(Outbox HTTP는 `X-Delivery-Id`·`X-Attempt`·`X-Trace-Context-Version`) | 수신 agent와 요청 필터. 서비스 인증·허용 경로를 통과한 내부 호출에서만 앱 문맥 수용. 인증 헤더와 추적 헤더는 별개 |
| Outbox 내부 metadata | `origin_trace_id`, `origin_request_id`, 지원 시 원인 trace carrier, metadata version | Data 명령 TX에 함께 저장. Relay는 전달 행별 scope를 열고 닫음 |
| Kafka headers | 현재 발행 시도의 trace carrier, `x-origin-trace-id`, `x-origin-request-id` | producer agent + 명시 metadata. consumer가 검증 후 복원 |
| 도메인 이벤트 봉투 | 기존 `eventId` 유지 | listener가 `event_id`로 기록. 원래 봉투·checksum·idempotency key를 추적 metadata 때문에 바꾸지 않음 |
| Notification 후속 작업 DB | event ID·origin trace/request ID | 수신과 실제 발송이 다른 시각·thread라 새 작업 scope에서 복원 |
| Redis Pub/Sub 내부 봉투 | versioned nullable telemetry carrier, origin trace/request ID, event ID 또는 message ID | 발행 직전 저장, subscriber 진입에서 복원 후 종료 시 정리. 앱으로 보내는 기존 봉투에는 추가하지 않음 |

재시도는 같은 `event_id`와 별도 `attempt`를 가진다. fan-out에서 수신자별 event ID가 다르면 원요청의 `origin_trace_id`로 사건들을 함께 찾는다. 보존이 끝난 원인 trace를 가리키더라도 event ID로 남은 로그는 조회할 수 있다. 사용자 ID·시간 유사성만으로 사건을 합치지 않는다.

### 3.1 원인 문맥의 보존·재사용 규칙

- `request_id`는 현재 동기 HTTP 요청 번호, `origin_request_id`는 최초 원인 요청 번호다. agent 미활성·APM 만료 때도 후자를 조회할 수 있어야 한다.
- **이미 있는 origin을 우선한다.** 최초 비동기 생성에서만 현재 실제 trace/request를 origin으로 저장하고, 후속 이벤트 생성·Relay 재시도·소비 재시도는 이를 그대로 전달한다. T1→T2→T3에서 origin을 T2/T3으로 바꾸지 않는다.
- 업무 멱등 재요청이 기존 Outbox 행을 반환하면 원래 origin을 수정하지 않는다. 새 요청의 로그에 `event_id`·기존 origin을 기록해 두 요청에서 같은 사건으로 이동할 수 있게 한다(2557 미구현·후속).
- carrier를 읽는 코드는 길이·형식·metadata version을 검증한다. 손상되거나 알 수 없는 추적 metadata는 무시하고 진단 카운터를 올리되(카운터는 2557 미구현·후속), 정상 도메인 이벤트 처리를 실패시키거나 DLT로 보내지 않는다. metadata 추출 예외 때문에 업무 TX를 롤백하지 않는다.
- 비동기 worker가 T2로 내부 HTTP를 호출하거나 HTTP Outbox transport를 이용할 때도 최초 T1/R1을 origin headers로 전파한다. 현재 trace만 전달하면 수신 측에서 origin을 잃는다. 공통 HTTP client와 Outbox HTTP transport 양쪽을 적용 대상으로 삼는다(2557은 Outbox HTTP transport만, 공통 client와 Data `/internal/*` 수신의 `X-Origin-*` 채택은 미구현·후속). reserved 추적 headers는 앱 입력·임의 `declaredHeaders`가 덮어쓰지 않도록 제한한다.
- 기존 Outbox의 trace는 현재 활성 tracer API에서 캡처한다. encoder가 나중에 만드는 canonical 문자열을 `MDC.get("dd.trace_id")`에서 찾지 않는다. provider와 저장 경계가 같은 정규화 함수를 사용하도록 계약 테스트를 둔다.
- `attempt`는 단계별 로컬 시도 번호다. 서비스·전달 ID·operation ID 없이 attempt 숫자만으로 같은 시도를 판정하지 않는다.

### 3.2 Redis를 건너는 Realtime

[ChatFanoutEvent](../../../server/realtime/src/main/java/com/oneorthree/realtime/fanout/ChatFanoutEvent.java)는 `chat:fanout`, [RealtimeEventFanoutEvent](../../../server/realtime/src/main/java/com/oneorthree/realtime/event/RealtimeEventFanoutEvent.java)는 `chat:events:v1` 내부 wire다. 두 채널에 nullable telemetry metadata를 추가하되 기존 클라이언트 메시지·7필드 사건 봉투와 수신 권한 로직을 변경하지 않는다. 구버전 consumer의 알 수 없는 필드 허용 여부를 실제 ObjectMapper로 확인했고 **순서 제약은 없다**(Jackson 3 기본값은 알 수 없는 속성을 무시하며, `InboundEventServiceTest`가 신→구·구→신 양방향을 읽는다). consumer 선배포 단계는 필요 없다.

발행 인스턴스 A의 문맥을 Redis subscriber B의 ThreadLocal이 자동으로 물려받지는 않는다. B는 carrier를 추출해 앱 ID scope를 만들고 `finally`에서 복원한다. 메시지 처리 span 생성은 이번 구현 범위가 아니라 후속이다. Redis client 명령 span이 생긴다는 것만으로 Pub/Sub 수신까지 연결됐다고 판정하지 않는다. 자기 인스턴스 메아리 제외와 로컬/원격 전달 중복 방지는 기존 계약을 유지한다.

채팅의 안정 키는 도메인 `messageId`를 로그의 `message_id`로 매핑한다. 채팅 본문·recipients 목록·토큰을 로그에 넣지 않는다. Pub/Sub publish 성공과 앱 수신 성공은 구분한다. subscriber 단절·역직렬화 실패는 현재 전달 보장의 한계로 남기며 관측 변경으로 Redis가 내구 큐가 됐다고 주장하지 않는다.

구현에서 정한 점은 다음과 같다.

- telemetry는 전용 lenient 역직렬화기로 읽는다. 형식이 하나라도 어긋나면 필드 단위로 살리지 않고 telemetry **전체**를 버리며 봉투는 그대로 처리한다.
- subscriber scope는 역직렬화 성공 직후, 자기 echo 판정 **전**에 연다. `self_echo` 줄도 원인과 ID를 단다. 결과는 `delivered|self_echo|invalid|failed` 한 줄이며, 역직렬화에 실패한 `invalid` 줄에는 scope가 없다.
- 세션 폐기 제어 사건도 `chat:events:v1`을 쓰며 Data 사건 id를 telemetry `eventId`로 싣는다.
- `chat:sea:v1`(`SeaRoomFanoutEvent`)도 같은 nullable telemetry를 싣는다(2581). `eventId`는 바다 방 사건의 `eventId`(클라이언트가 받는 6필드 사건의 id)이고, 발행·수신 줄(`fanout.publish`·`fanout.receive`)이 그 `event_id`와 원인을 단다. Data 사건이 일으킨 바다 방 사건은 Data `event_id`가 아니라 origin으로 잇는다. `SeaRoomEvent.eventId`는 방 사건마다 새로 만든 UUID v7(`SeaRoomEvent.of`)이라 상위 사건 ID에서 파생되지 않는다 — 바다 방 발행·수신 구간에서는 `event_id`가 방 사건 ID로 바뀌고 상위 사건과는 `origin_*`로만 이어진다.
- 이동 채널은 명령(`chat:movement:cmd:v1*`, `MovementRelay.Command`)에만 nullable telemetry를 싣는다(2581). STOMP 프레임이 일으킨 JOIN·LEAVE·INTENT·FULL_STATE는 그 프레임의 `request_id`가 origin, RECHECK는 강퇴 사건의 `event_id`·origin이다. 소켓 종료가 일으킨 LEAVE처럼 원인 문맥이 없는 스레드의 명령은 싣지 않는다. 받는 인스턴스는 처리 동안 설치하고, 길잡이 작업·재검사 판정까지 같은 값을 싣고 간다. 잃은 RECHECK 재송 장부는 telemetry를 뺀 명령을 키로 써서, 원인만 다른 같은 섬·사용자 재검사를 종전처럼 하나로 합치고 먼저 잃은 것의 telemetry를 남긴다(2581 r1, `MovementClusterTest.recheckLedgerMergesRegardlessOfTelemetry`). 감시가 만든 PING·RESYNC·EVICTED와 틱이 만든 프레임(`chat:movement:frames:v1`)은 싣지 않는다 — 프레임은 여러 요청이 섞인 결과라 원인 하나로 대표할 수 없다. 이동 경로에는 성공 줄을 새로 두지 않았다(INTENT 초당 10건) — 문맥은 기존 실패·종료 로그에 붙는다.
- 두 wire의 혼합 배포는 다른 채널과 같다 — 옛 인스턴스는 모르는 `telemetry` 키를 무시하고, 새 인스턴스는 키 없는 옛 JSON을 `telemetry=null`로 읽는다(`FanoutLogContextIntegrationTest.seaWireReadsAcrossVersions`, `MovementClusterTest.commandWireReadsAcrossVersions`).
- subscriber 단절을 구분하는 로그는 후속이다. 이번 구현은 역직렬화 실패만 `invalid`로 구분한다.

### 3.3 기기별 발송 시도 연결 (Notification)

[DispatchService](../../../server/notification/src/main/java/com/oneorthree/notification/DispatchService.java)의 한 `Plan`은 전달 행 1개 × 기기 N개다. 티켓 2421이 묶음 발송을 제거해 `lockedCandidates`는 행 1개이고, `collapseEventId()`는 그 행의 `event_id`를 돌려준다. `bundle:` 접두어를 만드는 코드는 없다. 발송 장애를 원요청에서 따라가려면 기기별 외부 호출 하나를 원사건에 연결할 키가 필요하다.

1. 기기별 `transport.send` 한 번마다 UUID `operation_id`를 발급한다. 기기가 다르거나 재시도하면 다른 operation이다. collapse 키(`event_id`)와 발송 멱등키는 바꾸지 않는다.
2. 그 호출에 포함되는 각 전달 행(구성원)마다 `event_name=operation.link`, `operation_id`, `delivery_id`, 실제 `event_id`, 해당 origin trace/request ID, `attempt`를 가진 연결 로그를 남긴다. `attempt`는 이 dispatch가 본 `attempts+1`이다. `delivery_id`는 notification `deliveries.id`이며 수신(consumer) 로그의 ID 공간과 다르다. 연결 로그의 `log_id`는 각각 다르다. 지금은 구성원이 1개이므로 호출당 연결 로그도 1개다.
3. 같은 operation scope 안에서 `transport.result`와 FcmTransport 실패 로그가 같은 `operation_id`를 가진다. 원인 문맥은 바깥 scope에서 오며, 구성원이 여러 개라 원인이 갈리면 임의의 한 origin/event ID를 넣지 않는다. DB 반영 결과는 `dispatch.settle` 로그로 따로 남기고 라벨은 sent·retry·failed·expired·lease_lost·unchanged 중 하나다. 외부 호출 결과(`transport.result`)와 DB의 최종 상태 반영 결과(`dispatch.settle`)를 구분한다.
4. 각 원요청의 조회 결과에서 연결 로그를 찾고 `operation_id`를 클릭해 해당 기기 호출의 발송 로그로 이동한다. 긴 event ID 배열을 메시지에 넣어 잘리게 하지 않는다.
5. 연결 로그 일부가 유실될 수 있는 관측 한계는 그대로다. producer 처리량 대비 연결 로그량도 측정하며 로그 저장 성공을 발송의 선행 조건으로 삼지 않는다.

묶음이 다시 생겨 한 호출에 구성원이 여럿이 되면 구성원마다 연결 로그를 남기고 원인 키를 한 개로 대표시키지 않는 설계다. 이 경로는 현재 도달할 수 없으며 `logLink` 단위 테스트로만 검증했다.

### 3.4 외부 ingress와 인증·에러 경계

공개 요청은 신뢰 경계에서 새 server trace를 시작하는 것을 기본안으로 한다. Nginx 등 공개 ingress에서 현재 tracer가 추출하도록 설정한 외부 trace headers와 내부 전용 origin/event/delivery/operation headers를 제거하고, 내부 서비스 간 HTTP에서는 실제 tracer headers와 검증된 앱 문맥을 전달한다. agent가 servlet filter보다 먼저 incoming trace를 추출하므로 앱 필터에서 뒤늦게 삭제하는 방식만으로는 이를 보장할 수 없다. 외부 trace 허용이 필요해지면 별도 규약으로 변경한다. 내부 호출까지 전역 extraction을 꺼서 연결을 끊지 않는다.

Nginx는 서버가 생성한 `$request_id`를 `edge_request_id`로 access 로그에 기록하고 신뢰된 upstream에 전달한다. 클라이언트가 같은 이름의 헤더를 보내도 ingress에서 덮어쓴다. Business 요청 로그는 이 값과 별도로 `request_id`를 기록한다. upstream 연결 실패·Nginx 자체 413/502/504처럼 JVM에 도달하지 않은 요청은 edge access 로그에서 찾고 존재하지 않는 앱 trace를 만들지 않는다. 실제 dev 호스트 Nginx와 prod 컨테이너 Nginx의 설정·출력 경로를 각각 검증한다.

stock Nginx의 `log_format`은 access 로그 설정이며 error 로그에 임의 edge ID가 자동으로 붙지는 않는다. access에 connection·connection request count도 기록하고, error는 인스턴스·connection·시간으로 보조 연계하되 HTTP/2 병렬 요청 등을 요청 단위로 확정 연결했다고 하지 않는다. error 원문에 URI query/referrer가 들어갈 수 있으므로 별도 parser에서 민감값을 제거한 후 sink로 보낸다. [Nginx access 형식](https://nginx.org/en/docs/http/ngx_http_log_module.html#log_format), [1.28 error 처리 소스](https://github.com/nginx/nginx/blob/release-1.28.0/src/http/ngx_http_request.c)

APP access 로그는 요청 완료 시 한 번 남기는 것을 기본으로 하고 method·정규화 route·최종 상태·duration·outcome을 기록한다. error dispatch나 async servlet 처리가 생기면 최초 filter 반환만으로 완료라고 하지 않고 완료 callback에서 한 번 기록한다. 아직 최종 HTTP 응답이 정해지지 않은 예외에서는 `getStatus()`의 기본 200을 성공으로 쓰지 않고 `outcome=unhandled_exception`과 상태 미확정을 표시한다. 사용자 본문·query string·인증 헤더를 수집하지 않는다.

## 4. 각 로그는 어떻게 JOIN하나

### 4.1 저장과 조회를 분리한다

**저장 시:** 각 로그는 독립 JSON 레코드다. Fluent Bit은 여러 서비스 스트림을 같은 스키마로 모아 Loki와 S3로 전달한다. 요청 완료를 기다려 하나의 큰 JSON으로 합치는 aggregator는 만들지 않는다.

**조회 시:** 공통 ID로 관련 레코드를 선택하고 시간 순서로 펼친다. 이 작업은 대체로 **UNION + filter + sort**이며 서비스 로그끼리의 N×M SQL JOIN이 아니다. `trace_id`로 HTTP 호출들을, `origin_trace_id`/`event_id`로 비동기 후속 처리들을 연결한다. 여러 사건을 합친 공통 작업은 연결 로그에서 `operation_id`를 얻어 한 번 더 조회한다. 인과 순서는 span 관계·이벤트 발행/소비 단계도 함께 확인한다.

| 사용자 입력 | 조회 경로 |
| --- | --- |
| 요청 번호 R1 | `request_id=R1` 또는 `origin_request_id=R1` → trace T1·event ID·operation ID로 확장 |
| trace T1 | 같은 trace 로그 + T1에서 파생된 비동기 로그 |
| 사건 E1 | `event_id=E1` → 각 delivery/attempt와 처리 trace 조회 |
| 기기 호출 OP1 | 연결 로그의 `operation_id=OP1` → 해당 기기 호출의 transport 처리·결과 조회 |
| 채팅 M1 | `message_id=M1` → 발행 인스턴스·Redis subscriber·outbound 전달 로그 |
| 키 없는 인프라 오류 | 환경·인스턴스·시간으로 범위 제한. 특정 요청과의 인과관계는 미확정으로 표시 |

### 4.2 화면에 모이는 로그 예시

| 시각 | 서비스/thread | trace | span | origin | event | 로그 |
| --- | --- | --- | --- | --- | --- | --- |
| 12:00:00.000 | Business/http-17 | T1 | B1 | — | — | 요청 시작 R1 |
| 12:00:00.010 | Business/http-worker | T1 | B2 | — | — | Data 호출 |
| 12:00:00.020 | Data/http-9 | T1 | D1 | — | E1 | 도메인 처리·Outbox 기록 |
| 12:00:00.050 | Business/http-17 | T1 | B1 | — | — | 200 응답, 50ms |
| 12:00:01.000 | Data/scheduler-1 | T2 | R2 | T1 | E1 | Kafka 발행 attempt=1 |
| 12:00:01.020 | Notification/kafka-0 | T2 | N1 | T1 | E1 | 소비·발송 예약 |
| 12:00:03.000 | Notification/sender-3 | T3 | N2 | T1 | E1 | 외부 발송 timeout attempt=1 |
| 12:00:05.000 | Notification/sender-1 | T4 | N3 | T1 | E1 | 외부 발송 성공 attempt=2 |

시간·ID는 합성 예시다. 실제 request/event 경계 로그를 추가해야 이런 연결을 관측할 수 있다. SQL/JDBC span의 bind 값이나 민감한 요청 본문을 전부 로그로 남길 필요는 없다.

### 4.3 Loki 쿼리

환경과 시간 범위를 먼저 선택하고 다음 쿼리를 실행한다. ID는 JSON 필드이며 Loki label이 아니다.

```logql
{env="prod"} | json | request_id="R1" or origin_request_id="R1"
{env="prod"} | json | trace_id="T1" or origin_trace_id="T1"
{env="prod"} | json | event_id="E1"
{env="prod"} | json | operation_id="OP1"
{env="prod", service="realtime"} | json | message_id="M1"
```

두 번째 쿼리는 단일 origin이 보존된 동기·비동기 로그를 모은다. 기기별 발송은 연결 로그를 찾은 뒤 네 번째 쿼리를 추가 실행해야 그 기기 호출의 결과까지 볼 수 있다. 오래 지연된 작업은 조회 시간 범위를 넓혀야 한다. Loki는 관계형 JOIN 엔진으로 사용하지 않는다. 관련 ID를 클릭하면 미리 구성한 Explore 쿼리 또는 APM 링크로 이동한다. 자동 dedup을 가정하지 않고 `log_id`를 로그 상세에 노출한다. [LogQL label filter 문서](https://grafana.com/docs/loki/latest/query/log_queries/)

Explore 화면의 행 상한·API `limit`에 도달한 결과를 전체 로그라고 표시하지 않는다. 대량 조사·export는 시간/서비스 범위를 나누고 경계 시각을 겹쳐 조회한 뒤 log ID로 중복 제거한다. 같은 timestamp에 상한 이상의 로그가 몰리면 시간만 좁혀도 해결되지 않으므로 service/source 또는 S3 archive 조회로 전환한다. live tail의 재연결 구간도 범위 조회로 확인한다. [Loki 조회 API](https://grafana.com/docs/loki/latest/reference/loki-http-api/)

### 4.4 S3/Athena 조회 예시

아래는 P2에서 만들 `ops_logs` 테이블의 목표 쿼리다. `env`, `service`, `archive_date`, `archive_hour`는 S3 key 파티션이고 나머지는 JSON 필드로 매핑한다. SQL은 현재 운영 테이블에서 실행한 결과가 아니다.

```sql
WITH base AS (
    SELECT "timestamp", observed_at, service, thread, log_id,
           trace_id, span_id, origin_trace_id, request_id, origin_request_id,
           event_id, operation_id, message,
           "$path" AS archive_path
    FROM ops_logs
    WHERE env = 'prod'
      AND service IN ('business-api', 'data-api', 'notification', 'realtime')
      AND archive_date BETWEEN '2026-10-29' AND '2026-10-30'
), seed AS (
    SELECT * FROM base
    WHERE trace_id = 'T1' OR origin_trace_id = 'T1' OR event_id = 'E1'
       OR request_id = 'R1' OR origin_request_id = 'R1'
), linked_operations AS (
    SELECT DISTINCT operation_id FROM seed WHERE operation_id IS NOT NULL
), selected AS (
    SELECT * FROM base
    WHERE log_id IN (SELECT log_id FROM seed WHERE log_id IS NOT NULL)
       OR trace_id = 'T1' OR origin_trace_id = 'T1' OR event_id = 'E1'
       OR request_id = 'R1' OR origin_request_id = 'R1'
       OR operation_id IN (SELECT operation_id FROM linked_operations)
), numbered AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY log_id ORDER BY observed_at, archive_path
    ) AS copy_number
    FROM selected
)
SELECT "timestamp", service, thread, trace_id, span_id,
       origin_trace_id, event_id, operation_id, message
FROM numbered
WHERE log_id IS NULL OR copy_number = 1
ORDER BY from_iso8601_timestamp("timestamp"), log_id;
```

`log_id`가 같은 수집 재전송만 제거한다. 같은 `event_id`에 속해도 재시도·여러 단계의 로그는 각각 남긴다. 구형 로그에서 log ID가 없으면 모두 남겨 과도한 dedup을 피한다. 위 날짜 범위는 예시이며 S3 객체의 첫 레코드 시간·지연 수집을 고려한 범위 확장은 [원본 조회 규칙](README.md#6-조회장애-분석-흐름)을 따른다.

`linked_operations`는 사건→공통 작업의 semijoin이다. 로그 행끼리 곱집합을 만들지 않는다. 이것은 범위 안의 한 단계 연결 확장 예시이며, 장기간·여러 번 합쳐진 작업의 모든 관계를 자동으로 순회하는 그래프 엔진은 아니다. 관계 로그가 범위 밖이면 범위를 넓혀 다시 조회한다.

공통 operation으로 확장하면 다른 원요청의 연결 로그도 보일 수 있다. UI/보고서에서는 이를 공유 작업의 다른 contributor로 구분하고 원래 trace/origin 값을 유지한다. 결과 전체를 최초 요청 하나가 만든 사건으로 재분류하지 않는다.

## 5. 이 상세 설계의 완료 조건

- JSON 설정이 네 서비스에서 기동되고, custom provider가 기존 UUID와 실제 trace ID를 혼동하지 않는다.
- `http→screen pool→HTTP pool→Data`를 통과한 요청이 같은 trace/request ID로 조회된다.
- A/B 요청을 같은 worker에 순차·동시·중첩 실행해 MDC가 섞이지 않는다. 실패·취소·제출 거절도 검사한다.
- async 로그 출력을 켠 테스트에서도 이벤트 발생 시점 DD ID·thread가 보존된다. 출력 worker의 ID로 바뀌지 않는다.
- 원요청 종료·프로세스 재시작 후 Outbox·Notification 작업을 실행해 origin/event ID로 연결한다.
- 합성 로그 표를 Loki/Athena에 적재해 T1 조회에 T2/T3/T4 후속 로그가 포함되고 무관한 요청은 제외되는지 확인한다. 공통 operation으로 연결된 다른 요청의 contributor는 별도로 구분한다.
- 같은 log ID 재전송만 제거되고, 같은 event ID의 서로 다른 단계·재시도는 남는다.
- 서로 다른 두 요청의 이벤트가 한 푸시로 합쳐져도 각 요청에서 같은 operation의 실패에 도달한다.
- 두 Realtime 인스턴스에서 Redis를 건넌 사건·채팅을 event/message ID로 찾고, 구버전 wire·subscriber 단절을 구분한다.
- agent가 없는 요청·다단계 이벤트·업무 멱등 재요청에서도 최초 원인 ID가 덮어써지지 않는다.

이 문서 작성 시 검증한 것은 코드 경계·공식 문서·XML의 well-formedness·상대 링크다. custom provider/decorator 빌드, LogQL/Athena 실제 실행, 위 통합 테스트와 운영 적용은 아직 실행하지 않았다.
