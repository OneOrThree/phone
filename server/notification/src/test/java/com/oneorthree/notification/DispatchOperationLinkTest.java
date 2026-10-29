package com.oneorthree.notification;

import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.GoogleCredentials;
import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

/**
 * 기기별 전송 시도를 원본 이벤트와 잇는 로그 (GROMO-2558).
 *
 * <p>묶음 발송은 제거돼 한 Plan 은 delivery 하나다. 그래서 묶음은 구성원 목록을 받는 {@code logLink} 단위로,
 * 나머지(멀티기기·재시도·실패·무관한 delivery)는 실제 dispatch 경로로 검증한다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class DispatchOperationLinkTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final Instant DAY = Instant.parse("2026-09-12T03:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired InboundService inbound;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    /** 로그를 낸 스레드의 MDC 를 그 자리에서 붙잡는다. */
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>() {
        @Override
        protected void append(ILoggingEvent event) {
            event.prepareForDeferredProcessing();
            super.append(event);
        }
    };

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,"
                + "user_fences,settings,projections,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        store.update("UPDATE jobs SET enabled=false");
        store.update("DELETE FROM job_runs");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('FRIEND_ACCEPTED','BYPASS')");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('FRIEND_ACCEPTED.ko','FRIEND_ACCEPTED','ko','내기','결과가 나왔어요')");
        reset(transport, data, clock);
        when(clock.instant()).thenReturn(DAY);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        logs.list.clear();
        logs.start();
        Logger logger = (Logger) LoggerFactory.getLogger(DispatchService.class);
        logger.setLevel(Level.INFO);
        logger.addAppender(logs);
        ((Logger) LoggerFactory.getLogger(FcmTransport.class)).addAppender(logs);
    }

    @AfterEach
    void release() {
        ((Logger) LoggerFactory.getLogger(DispatchService.class)).detachAppender(logs);
        ((Logger) LoggerFactory.getLogger(FcmTransport.class)).detachAppender(logs);
        logs.stop();
    }

    @Test
    void eachDeviceCallGetsItsOwnOperationAndOriginFindsOnlyItsOwnResults() {
        register("fcm-a", "boot-a", "reg-a");
        register("fcm-b", "boot-b", "reg-b");
        UUID first = enqueue("e1", "R1", "111", null);
        UUID other = enqueue("e2", "R2", "222", null);
        dispatch.dispatch(first);
        dispatch.dispatch(other);

        Set<String> r1 = operationsOf("R1");
        Set<String> r2 = operationsOf("R2");
        assertThat(r1).hasSize(2);
        assertThat(r2).hasSize(2).doesNotContainAnyElementsOf(r1);
        assertThat(named("operation.link")).hasSize(4);
        assertThat(resultsOf(r1)).hasSize(2).allMatch(e -> e.getFormattedMessage().contains("result=SENT"));
        assertThat(resultsOf(r2)).hasSize(2);
        // 같은 delivery 의 두 기기 link 는 delivery_id·event_id·origin 이 같고 operation_id 만 다르다.
        assertThat(named("operation.link").stream().filter(e -> "R1".equals(mdc(e).get("origin_request_id")))
                .map(e -> mdc(e).get("delivery_id")).collect(Collectors.toSet())).containsExactly(first.toString());
        assertThat(named("operation.link").stream().map(e -> mdc(e).get("origin_trace_id")).collect(Collectors.toSet()))
                .containsExactlyInAnyOrder("111", "222");
        assertThat(named("dispatch.settle")).hasSize(2)
                .allMatch(e -> e.getFormattedMessage().contains("state=sent"));
    }

    @Test
    void aRetryGetsANewOperationAndTheNextAttemptNumberWithTheSameOrigin() {
        register("fcm-a", "boot-a", "reg-a");
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.RETRY);
        UUID id = enqueue("e1", "R1", null, null);
        dispatch.dispatch(id);
        when(clock.instant()).thenReturn(DAY.plusSeconds(120));
        dispatch.dispatch(id);

        List<ILoggingEvent> links = named("operation.link");
        assertThat(links).hasSize(2);
        assertThat(mdc(links.get(0)).get("operation_id")).isNotEqualTo(mdc(links.get(1)).get("operation_id"));
        assertThat(mdc(links.get(0))).containsEntry("attempt", "1").containsEntry("origin_request_id", "R1");
        assertThat(mdc(links.get(1))).containsEntry("attempt", "2").containsEntry("origin_request_id", "R1");
        assertThat(named("dispatch.settle")).allMatch(e -> e.getFormattedMessage().contains("state=retry"));
    }

    @Test
    void settleStateReportsFailedAndExpired() {
        register("fcm-a", "boot-a", "reg-a");
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.RETRY);
        UUID exhausted = enqueue("e1", "R1", null, null);
        store.update("UPDATE deliveries SET attempts=59 WHERE id=?", exhausted);
        dispatch.dispatch(exhausted);
        assertThat(named("dispatch.settle")).singleElement()
                .satisfies(e -> assertThat(e.getFormattedMessage()).contains("state=failed"));

        logs.list.clear();
        UUID timed = enqueue("e2", "R2", null, DAY.plusSeconds(30));
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            when(clock.instant()).thenReturn(DAY.plusSeconds(60));
            return PushTransport.Result.RETRY;
        });
        dispatch.dispatch(timed);
        assertThat(named("dispatch.settle")).singleElement()
                .satisfies(e -> assertThat(e.getFormattedMessage()).contains("state=expired"));
    }

    @Test
    void anOldRowWithoutOriginStillSendsAndTheLinkCarriesNoOriginKeys() {
        register("fcm-a", "boot-a", "reg-a");
        UUID id = enqueue("e1", null, null, null);
        dispatch.dispatch(id);

        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
        assertThat(named("operation.link")).singleElement().satisfies(e -> assertThat(mdc(e))
                .containsEntry("delivery_id", id.toString()).containsEntry("event_id", "e1")
                .doesNotContainKeys("origin_request_id", "origin_trace_id"));
    }

    @Test
    void everyMemberOfASharedCallGetsItsOwnLinkLine() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        DispatchService.logLink("op-1", List.of(a, b), Map.of(
                a, new DispatchService.Cause("ea", "RA", "1", 1), b, new DispatchService.Cause("eb", "RB", null, 3)));

        assertThat(named("operation.link")).hasSize(2);
        assertThat(named("operation.link").stream().map(e -> mdc(e).get("origin_request_id")).toList())
                .containsExactly("RA", "RB");
        assertThat(named("operation.link").stream().map(e -> mdc(e).get("operation_id")).collect(Collectors.toSet()))
                .containsExactly("op-1");
        assertThat(mdc(named("operation.link").get(1))).doesNotContainKey("origin_trace_id");
        assertThat(MDC.get("origin_request_id")).isNull();
    }

    @Test
    void fcmFailureLogInsideSendCarriesTheCallsOperationIdAndNothingLeaksAfter() throws IOException {
        register("fcm-a", "boot-a", "reg-a");
        HttpServer fcm = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        fcm.createContext("/", exchange -> {
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(503, body.length);
            try (var out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        fcm.start();
        try {
            FcmTransport real = new FcmTransport("test-project", GoogleCredentials.create(
                    new AccessToken("t", new Date(System.currentTimeMillis() + 3600000))),
                    "http://127.0.0.1:" + fcm.getAddress().getPort(), new SimpleMeterRegistry());
            // 실제 FcmTransport 의 실패 로그 경로를 태운다.
            when(transport.send(anyString(), any(), anyBoolean(), anyString()))
                    .thenAnswer(call -> real.send(call.getArgument(0), call.getArgument(1),
                            call.getArgument(2), call.getArgument(3)));
            dispatch.dispatch(enqueue("e1", "R1", null, null));
        } finally {
            fcm.stop(0);
        }

        String operation = operationsOf("R1").iterator().next();
        List<ILoggingEvent> failures = logs.list.stream()
                .filter(e -> e.getFormattedMessage().startsWith("FCM 발송 실패")).toList();
        assertThat(failures).singleElement().satisfies(e -> assertThat(mdc(e))
                .containsEntry("operation_id", operation).doesNotContainKey("event_name"));
        assertThat(resultsOf(Set.of(operation))).singleElement()
                .satisfies(e -> assertThat(e.getFormattedMessage()).contains("result=RETRY"));
        assertThat(MDC.get("operation_id")).isNull();
    }

    @Test
    void dispatchRestoresTheCallerMdc() {
        register("fcm-a", "boot-a", "reg-a");
        UUID id = enqueue("e1", "R1", null, null);
        MDC.put("origin_request_id", "outer");
        try {
            dispatch.dispatch(id);
            assertThat(MDC.get("origin_request_id")).isEqualTo("outer");
            assertThat(MDC.get("operation_id")).isNull();
            assertThat(MDC.get("delivery_id")).isNull();
            assertThat(MDC.get("event_name")).isNull();
        } finally {
            MDC.remove("origin_request_id");
        }
    }

    private List<ILoggingEvent> named(String eventName) {
        return List.copyOf(logs.list).stream().filter(e -> eventName.equals(mdc(e).get("event_name"))).toList();
    }

    private Set<String> operationsOf(String origin) {
        return named("operation.link").stream().filter(e -> origin.equals(mdc(e).get("origin_request_id")))
                .map(e -> mdc(e).get("operation_id")).collect(Collectors.toSet());
    }

    private List<ILoggingEvent> resultsOf(Set<String> operations) {
        return named("transport.result").stream().filter(e -> operations.contains(mdc(e).get("operation_id"))).toList();
    }

    private static Map<String, String> mdc(ILoggingEvent event) {
        return event.getMDCPropertyMap();
    }

    private UUID enqueue(String eventId, String originRequest, String originTrace, Instant expiresAt) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", "FRIEND_ACCEPTED");
        if (expiresAt != null) {
            params.put("expiresAt", expiresAt.toString());
        }
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", eventId);
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", USER.toString());
        event.put("version", 1);
        event.put("subjectId", UUID.randomUUID().toString());
        event.put("locale", "ko");
        event.put("occurredAt", DAY.toString());
        event.put("scheduledAt", DAY.toString());
        event.put("params", params);
        inbound.receive(event, new InboundTrace(originRequest, originTrace, null, null));
        return (UUID) store.one("SELECT id FROM deliveries WHERE event_id=?", eventId).get("id");
    }

    private void register(String token, String bootstrap, String key) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deviceToken", token);
        body.put("deviceBootstrap", bootstrap);
        body.put("sessionEpoch", 1L);
        body.put("authGeneration", 0L);
        body.put("ownershipToken", null);
        devices.register(USER, body, key);
    }
}
