package com.oneorthree.phone.outbox.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.common.logging.ObservationJsonProvider;
import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.client.OutboxCarrier;
import com.oneorthree.phone.outbox.client.OutboxTransport;
import com.oneorthree.phone.outbox.client.OutboxTransportResult;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.IntFunction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * relay 실패 ERROR 로그는 같은 행에서 반복하지 않는다 (GROMO-2197) — 영구 실패는 사유가 바뀔 때만, 임계값 경고는 시도 수가
 * 임계값에 닿는 한 번만.
 *
 * <p>{@code attempt_count}·{@code last_error} 가 실제 선점·표시 SQL 에서 나와야 이 검사가 의미가 있어 실제 PostgreSQL 을
 * 쓴다. 시계만 목이라, 틱마다 백오프를 건너뛰어 같은 행을 다시 집게 한다.
 */
@SpringBootTest
@Import(OutboxRelayFailureLogIntegrationTest.Configuration.class)
class OutboxRelayFailureLogIntegrationTest {
    private static final Instant START = Instant.parse("2030-01-01T00:00:00Z");
    private static final AtomicReference<Instant> NOW = new AtomicReference<>(START);
    private static final Clock CLOCK = mock(Clock.class);
    private static final OutboxRelayProperties PROPERTIES = properties();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @TestConfiguration
    static class Configuration {
        @Bean
        OutboxRelayStore failureLogTestStore(EventOutboxDeliveryRepository repository) {
            return new OutboxRelayStore(repository, PROPERTIES, CLOCK, new SimpleMeterRegistry());
        }
    }

    @Autowired OutboxRelayStore store;
    @Autowired EventOutboxRepository outbox;
    @Autowired EventOutboxDeliveryRepository deliveries;
    @Autowired OutboxCommandPort commands;
    @Autowired PlatformTransactionManager transactionManager;

    private final Logger relayLog = (Logger) LoggerFactory.getLogger(OutboxRelayService.class);
    // MDC 는 로그를 낸 스레드에서 붙잡는다 — 시도 scope 는 로그 직후 닫혀서 지연 조회하면 비어 있다.
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>() {
        @Override
        protected void append(ILoggingEvent event) {
            event.prepareForDeferredProcessing();
            super.append(event);
        }
    };
    private final SimpleMeterRegistry metrics = new SimpleMeterRegistry();

    @BeforeEach
    void reset() {
        NOW.set(START);
        when(CLOCK.instant()).thenAnswer(invocation -> NOW.get());
        tx().executeWithoutResult(status -> {
            deliveries.deleteAllInBatch();
            outbox.deleteAllInBatch();
        });
        logs.start();
        relayLog.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        relayLog.detachAppender(logs);
        logs.stop();
    }

    @Test
    @DisplayName("영구 실패는 사유당 ERROR 한 번, 임계값 경고도 한 번 — 재시도는 계속되고 실패 카운터는 매번 센다")
    void permanentFailureLogsOnceAndTheThresholdWarningOnceWhileRetriesContinue() {
        UUID deliveryId = append();

        relayTimes(4, call -> OutboxTransportResult.permanent("HTTP 404"));

        assertThat(errors("재시도로 풀리지 않는", deliveryId))
                .as("같은 영구 사유를 재시도마다 다시 적으면 prod 에서 5분마다 같은 줄이 쌓인다").hasSize(1);
        assertThat(errors("임계값", deliveryId)).as("max-attempts=2 — 2번째 시도에서 한 번").hasSize(1);
        assertThat(deliveries.findById(deliveryId).orElseThrow().getAttemptCount())
                .as("로그를 줄였을 뿐 재시도는 멈추지 않는다(A18 보류)").isEqualTo(4);
        assertThat(metrics.get("outbox.relay.failed").tags("target", "KAFKA", "retryable", "false")
                .counter().count()).as("매 재시도는 카운터가 센다").isEqualTo(4);
    }

    @Test
    @DisplayName("재시도 가능한 실패는 영구 실패 로그 없이 임계값 경고만 한 번 남는다")
    void retryableFailureLogsOnlyTheThresholdWarningOnce() {
        UUID deliveryId = append();

        relayTimes(4, call -> OutboxTransportResult.retry("HTTP 500"));

        assertThat(errors("재시도로 풀리지 않는", deliveryId)).isEmpty();
        assertThat(errors("임계값", deliveryId)).hasSize(1);
        assertThat(deliveries.findById(deliveryId).orElseThrow().getAttemptCount()).isEqualTo(4);
    }

    @Test
    @DisplayName("영구 실패의 사유가 바뀌면 새 사유로 다시 한 번 남는다")
    void permanentFailureLogsAgainWhenTheReasonChanges() {
        UUID deliveryId = append();

        relayTimes(4, call -> OutboxTransportResult.permanent(call <= 2 ? "HTTP 404" : "HTTP 410"));

        assertThat(errors("재시도로 풀리지 않는", deliveryId))
                .hasSize(2)
                .satisfiesExactly(
                        message -> assertThat(message).contains("HTTP 404"),
                        message -> assertThat(message).contains("HTTP 410"));
    }

    @Test
    @DisplayName("리스를 잃은 낡은 소유자는 영구 실패 ERROR 를 남기지 않는다 — 표시가 거부돼 WARN 만 남고 ERROR 는 현재 소유자의 한 번뿐이다")
    void aStaleLeaseOwnerLogsNoPermanentFailureError() {
        UUID deliveryId = append();
        AtomicInteger currentOwnerCalls = new AtomicInteger();
        OutboxRelayService currentOwner =
                relayOf(currentOwnerCalls, call -> OutboxTransportResult.permanent("HTTP 404"));
        AtomicInteger staleOwnerCalls = new AtomicInteger();
        // 낡은 소유자의 전송이 진행되는 사이 리스(30초)가 만료되고, 다른 워커가 같은 행을 새 토큰으로 다시 집어 먼저 실패를 기록한다.
        OutboxRelayService staleOwner = relayOf(staleOwnerCalls, call -> {
            NOW.set(NOW.get().plusSeconds(31));
            currentOwner.relayTarget(OutboxTarget.KAFKA);
            return OutboxTransportResult.permanent("HTTP 404");
        });

        staleOwner.relayTarget(OutboxTarget.KAFKA);

        assertThat(currentOwnerCalls).as("현재 소유자가 같은 행을 다시 집어 보냈다").hasValue(1);
        assertThat(staleOwnerCalls).hasValue(1);
        assertThat(errors("재시도로 풀리지 않는", deliveryId))
                .as("낡은 소유자의 영구 실패까지 적으면 이미 남이 기록한 사유를 거부된 표시 위에 또 적는다").hasSize(1);
        assertThat(warnings("낡은 리스의 실패 표시를 거부했다", deliveryId))
                .as("낡은 소유자의 실패 표시는 토큰이 달라 0행 — 울타리 WARN 만 남는다").isNotEmpty();
        assertThat(deliveries.findById(deliveryId).orElseThrow().getAttemptCount())
                .as("선점은 두 번(낡은 소유자, 현재 소유자)").isEqualTo(2);
    }

    @Test
    @DisplayName("실제 JSON provider 로 렌더링한 시도 결과·축 예외 로그에 사건 연결 키가 나온다 (GROMO-2557)")
    void renderedJsonLogsCarryTheCorrelationKeys() throws Exception {
        UUID user = UUID.randomUUID();
        String eventId = "render-" + UUID.randomUUID();
        UUID deliveryId = appendWithOrigin(user, eventId, "req-render", "6720d0ec00000000a1b2c3d4e5f60718");

        relayTimes(1, call -> {
            throw new IllegalStateException("boom");
        });

        // 배포 경로와 같은 생성자(Environment) — 출력 allowlist 가 실제로 통과시키는지 본다.
        ObservationJsonProvider provider = new ObservationJsonProvider(new MockEnvironment()
                .withProperty("OBS_SERVICE", "data-api").withProperty("OBS_ENV", "dev")
                .withProperty("OBS_VERSION", "abc123"));
        ILoggingEvent result = logs.list.stream().filter(e -> e.getLevel() == Level.INFO
                && "outbox.delivery".equals(e.getMDCPropertyMap().get("event_name")))
                .findFirst().orElseThrow(() -> new AssertionError("시도 결과 로그가 없다"));
        ILoggingEvent axisError = logs.list.stream().filter(e -> e.getLevel() == Level.ERROR
                && e.getFormattedMessage().contains("전달 경로가 예외를 던졌다"))
                .findFirst().orElseThrow(() -> new AssertionError("예외 로그가 없다"));

        for (ILoggingEvent event : List.of(result, axisError)) {
            String line = provider.format(event);
            @SuppressWarnings("unchecked")
            Map<String, Object> json = new ObjectMapper().readValue(line, Map.class);
            assertThat(json).containsEntry("event_id", eventId).containsEntry("delivery_id", deliveryId.toString())
                    .containsEntry("attempt", 1).containsEntry("origin_request_id", "req-render")
                    .containsEntry("origin_trace_id", "6720d0ec00000000a1b2c3d4e5f60718");
        }
        assertThat(new ObjectMapper().readValue(provider.format(result), Map.class))
                .containsEntry("event_name", "outbox.delivery");
        assertThat(new ObjectMapper().readValue(provider.format(axisError), Map.class))
                .doesNotContainKey("event_name").containsEntry("level", "ERROR");
    }

    private UUID appendWithOrigin(UUID user, String eventId, String originRequest, String originTrace) {
        MDC.put("origin_request_id", originRequest);
        MDC.put("origin_trace_id", originTrace);
        try {
            tx().executeWithoutResult(status -> commands.append(new OutboxAppendCommand(
                    eventId, 1, "user.withdrawn", user, "ko", null,
                    AggregateRef.ofUser(user), null, Map.of(), List.of(OutboxDeliveryRequest.toKafka()))));
        } finally {
            MDC.remove("origin_request_id");
            MDC.remove("origin_trace_id");
        }
        return deliveries.findAll().stream().map(EventOutboxDelivery::getId).findFirst().orElseThrow();
    }

    /** 틱을 {@code times} 번 돌린다 — 틱마다 시계를 한 시간 밀어 백오프(최대 10초)를 건너뛴다. */
    private void relayTimes(int times, IntFunction<OutboxTransportResult> result) {
        AtomicInteger calls = new AtomicInteger();
        OutboxRelayService relay = relayOf(calls, result);
        for (int i = 0; i < times; i++) {
            relay.relayTarget(OutboxTarget.KAFKA);
            NOW.set(NOW.get().plus(Duration.ofHours(1)));
        }
        assertThat(calls).as("틱마다 한 번씩 실제로 집어 보냈다").hasValue(times);
    }

    /** 실제 store 를 쓰는 워커 — 전송할 때마다 {@code calls} 를 올리고 결과는 {@code result} 가 정한다. */
    private OutboxRelayService relayOf(AtomicInteger calls, IntFunction<OutboxTransportResult> result) {
        OutboxTransport transport = new OutboxTransport() {
            @Override
            public OutboxTarget target() {
                return OutboxTarget.KAFKA;
            }

            @Override
            public OutboxTransportResult send(EventOutboxDelivery delivery, UUID user, OutboxCarrier carrier) {
                return result.apply(calls.incrementAndGet());
            }
        };
        return new OutboxRelayService(store, outbox, PROPERTIES, CLOCK, List.of(transport), metrics, Runnable::run);
    }

    private List<String> errors(String fragment, UUID deliveryId) {
        return logged(Level.ERROR, fragment, deliveryId);
    }

    private List<String> warnings(String fragment, UUID deliveryId) {
        return logged(Level.WARN, fragment, deliveryId);
    }

    private List<String> logged(Level level, String fragment, UUID deliveryId) {
        return logs.list.stream()
                .filter(event -> event.getLevel() == level)
                .map(ILoggingEvent::getFormattedMessage)
                .filter(message -> message.contains(fragment) && message.contains("deliveryId=" + deliveryId))
                .toList();
    }

    private UUID append() {
        UUID user = UUID.randomUUID();
        tx().executeWithoutResult(status -> commands.append(new OutboxAppendCommand(
                "failure-log-test-" + UUID.randomUUID(), 1, "user.withdrawn", user, "ko", null,
                AggregateRef.ofUser(user), null, Map.of(), List.of(OutboxDeliveryRequest.toKafka()))));
        return deliveries.findAll().stream().map(EventOutboxDelivery::getId).findFirst().orElseThrow();
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static OutboxRelayProperties properties() {
        OutboxRelayProperties result = new OutboxRelayProperties();
        result.setBatchSize(10);
        result.setLeaseDuration(Duration.ofSeconds(30));
        result.setTickBudget(Duration.ZERO);
        result.getRetry().setInitialBackoff(Duration.ofSeconds(1));
        result.getRetry().setMaxBackoff(Duration.ofSeconds(10));
        result.getRetry().setMaxAttempts(2);
        return result;
    }
}
