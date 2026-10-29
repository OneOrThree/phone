package com.oneorthree.notification;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Header;
import org.apache.kafka.common.header.internals.RecordHeader;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import com.oneorthree.notification.logging.ObservationJsonProvider;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.kafka.core.KafkaTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.kafka.KafkaContainer;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.Mockito.verifyNoInteractions;

@SpringBootTest(properties = {"notification.kafka-enabled=true",
        "spring.kafka.consumer.auto-offset-reset=earliest", "spring.kafka.consumer.enable-auto-commit=false",
        "spring.kafka.listener.ack-mode=record",
        "spring.kafka.consumer.key-deserializer=org.apache.kafka.common.serialization.StringDeserializer",
        "spring.kafka.consumer.value-deserializer=org.apache.kafka.common.serialization.StringDeserializer",
        "spring.kafka.producer.key-serializer=org.apache.kafka.common.serialization.StringSerializer",
        "spring.kafka.producer.value-serializer=org.apache.kafka.common.serialization.StringSerializer",
        "spring.kafka.producer.properties.delivery.timeout.ms=2000",
        "spring.kafka.producer.properties.request.timeout.ms=1000",
        "spring.kafka.producer.properties.max.block.ms=2000"})
@ActiveProfiles("ci")
@AutoConfigureMockMvc
class KafkaInboundTest {
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka:3.8.1")
            .withEnv("KAFKA_AUTO_CREATE_TOPICS_ENABLE", "false");
    static {
        PG.start();
        KAFKA.start();
        try (AdminClient admin = AdminClient.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic("notification-events", 3, (short) 1),
                    new NewTopic("notification-events.DLT", 3, (short) 1))).all().get(20, TimeUnit.SECONDS);
        } catch (Exception failure) {
            throw new ExceptionInInitializerError(failure);
        }
    }
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
        registry.add("spring.kafka.bootstrap-servers", KAFKA::getBootstrapServers);
    }
    @Autowired Store store;
    @Autowired KafkaTemplate<Object, Object> kafka;
    @Autowired MockMvc mvc;
    @MockitoBean PushTransport transport;

    /** 수신 결과 로그 — MDC 는 로그를 낸 스레드에서 붙잡는다(지연 조회하면 테스트 스레드 MDC 를 읽는다). */
    private final ListAppender<ILoggingEvent> accepts = new ListAppender<>() {
        @Override
        protected void append(ILoggingEvent event) {
            event.prepareForDeferredProcessing();
            super.append(event);
        }
    };

    @BeforeEach
    void captureAcceptLogs() {
        accepts.start();
        ((Logger) LoggerFactory.getLogger(InboundTrace.class)).addAppender(accepts);
    }

    @AfterEach
    void releaseAcceptLogs() {
        ((Logger) LoggerFactory.getLogger(InboundTrace.class)).detachAppender(accepts);
    }

    @Test
    void redeliveryCommitsOneProjectionAndUnknownVersionIsPreservedInMatchingDltPartition() throws Exception {
        UUID user = UUID.randomUUID();
        Map<String, Object> event = NotificationStoreTest.event("kafka-dedup", "user.updated", user, 1, null,
                Map.of("locale", "ja"));
        String payload = Json.write(event);
        kafka.send("notification-events", 2, user.toString(), payload).get(10, TimeUnit.SECONDS);
        kafka.send("notification-events", 2, user.toString(), payload).get(10, TimeUnit.SECONDS);
        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
            assertThat(store.rows("SELECT * FROM inbound_events WHERE event_id='kafka-dedup'")).hasSize(1);
            assertThat(store.rows("SELECT * FROM projections WHERE user_id=?", user)).hasSize(1);
        });
        event.put("eventId", "kafka-future");
        event.put("schemaVersion", 2);
        String unsupported = Json.write(event);
        kafka.send(new ProducerRecord<>("notification-events", 2, user.toString(), unsupported,
                carrier("req-dlt", "kafka-future", "2"))).get(10, TimeUnit.SECONDS);
        try (KafkaConsumer<String, String> dlt = consumer()) {
            TopicPartition partition = new TopicPartition("notification-events.DLT", 2);
            dlt.assign(List.of(partition));
            dlt.seekToBeginning(List.of(partition));
            await().atMost(Duration.ofSeconds(25)).untilAsserted(() -> {
                var records = dlt.poll(Duration.ofMillis(500));
                assertThat(records.records(partition)).anySatisfy(record -> {
                    assertThat(record.value()).isEqualTo(unsupported);
                    // recoverer 기본 동작이 원본 헤더를 옮긴다 — DLT 에서도 원요청으로 찾아갈 수 있다(GROMO-2557).
                    assertThat(header(record.headers().lastHeader("x-origin-request-id"))).isEqualTo("req-dlt");
                    assertThat(header(record.headers().lastHeader("x-event-id"))).isEqualTo("kafka-future");
                    assertThat(header(record.headers().lastHeader("x-attempt"))).isEqualTo("2");
                });
            });
        }
        assertThat(store.rows("SELECT * FROM inbound_events WHERE event_id='kafka-future'")).isEmpty();
        verifyNoInteractions(transport);
    }

    @Test
    void missingDltNeverAcknowledgesUntilRecoveryCanPublish() throws Exception {
        UUID user = UUID.randomUUID();
        TopicPartition source = new TopicPartition("notification-events", 0);
        try (AdminClient admin = AdminClient.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.deleteTopics(List.of("notification-events.DLT")).all().get(10, TimeUnit.SECONDS);
            var event = NotificationStoreTest.event("kafka-dlt-unavailable", "unknown.kind", user, 1, null, Map.of());
            long offset = kafka.send(source.topic(), source.partition(), user.toString(), Json.write(event))
                    .get(10, TimeUnit.SECONDS).getRecordMetadata().offset();
            // 재시도가 끝나도 DLT에 보존하지 못하면 원본 offset을 진행하지 않는다.
            await().during(Duration.ofSeconds(7)).atMost(Duration.ofSeconds(12)).untilAsserted(() -> {
                var committed = admin.listConsumerGroupOffsets("notification-v1").partitionsToOffsetAndMetadata()
                        .get(5, TimeUnit.SECONDS).get(source);
                assertThat(committed == null || committed.offset() <= offset).isTrue();
            });
            admin.createTopics(List.of(new NewTopic("notification-events.DLT", 3, (short) 1)))
                    .all().get(10, TimeUnit.SECONDS);
            await().atMost(Duration.ofSeconds(25)).untilAsserted(() -> {
                var committed = admin.listConsumerGroupOffsets("notification-v1").partitionsToOffsetAndMetadata()
                        .get(5, TimeUnit.SECONDS).get(source);
                assertThat(committed).isNotNull();
                assertThat(committed.offset()).isGreaterThan(offset);
            });
            assertThat(store.rows("SELECT * FROM inbound_events WHERE event_id='kafka-dlt-unavailable'")).isEmpty();
        }
    }

    /** kafka-consumption.md §2·§4 — application.yml 의 할당 전략·concurrency 가 실제 그룹에 반영됐는지 브로커에 묻는다. */
    @Test
    void consumerGroupUsesCooperativeAssignorWithOneMemberOwningAllPartitions() throws Exception {
        try (AdminClient admin = AdminClient.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            // 기동 직후엔 코디네이터가 아직 없어 describe 가 예외를 던질 수 있다 — 단언 실패와 같이 재시도한다.
            await().ignoreExceptions().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
                var group = admin.describeConsumerGroups(List.of("notification-v1")).all()
                        .get(5, TimeUnit.SECONDS).get("notification-v1");
                assertThat(group.partitionAssignor()).isEqualTo("cooperative-sticky");
                assertThat(group.members()).hasSize(1);
                assertThat(group.members().iterator().next().assignment().topicPartitions())
                        .filteredOn(tp -> tp.topic().equals("notification-events")).hasSize(3);
            });
        }
    }

    @Test
    void carrierReachesTheDeliveryRowAndTheListenerThreadForgetsItBeforeTheNextRecord() throws Exception {
        UUID user = UUID.randomUUID();
        String traced = "kafka-origin-" + UUID.randomUUID();
        String legacy = "kafka-legacy-" + UUID.randomUUID();
        String trace = "6720d0ec00000000a1b2c3d4e5f60718";
        List<Header> headers = carrier("req-origin", traced, "2");
        headers.add(new RecordHeader("x-origin-trace-id", trace.getBytes(StandardCharsets.UTF_8)));
        kafka.send(new ProducerRecord<>("notification-events", 1, user.toString(), request(traced, user), headers))
                .get(10, TimeUnit.SECONDS);
        // 헤더 없는 구버전 레코드 — 같은 파티션이라 같은 리스너 스레드가 바로 뒤에 처리한다.
        kafka.send("notification-events", 1, user.toString(), request(legacy, user)).get(10, TimeUnit.SECONDS);

        await().atMost(Duration.ofSeconds(20)).untilAsserted(() ->
                assertThat(store.rows("SELECT * FROM deliveries WHERE event_id IN (?,?)", traced, legacy)).hasSize(2));
        assertThat(store.one("SELECT origin_request_id,origin_trace_id FROM deliveries WHERE event_id=?", traced))
                .containsEntry("origin_request_id", "req-origin").containsEntry("origin_trace_id", trace);
        assertThat(store.one("SELECT origin_request_id,origin_trace_id FROM deliveries WHERE event_id=?", legacy))
                .containsEntry("origin_request_id", null).containsEntry("origin_trace_id", null);

        ILoggingEvent first = acceptLog(traced);
        ILoggingEvent second = acceptLog(legacy);
        assertThat(first.getFormattedMessage()).contains("result=accepted").contains("source=kafka");
        assertThat(first.getMDCPropertyMap()).containsEntry("origin_request_id", "req-origin")
                .containsEntry("origin_trace_id", trace).containsEntry("delivery_id", "relay-delivery-1")
                .containsEntry("attempt", "2").containsEntry("event_name", "consumer.accept");
        // 같은 이벤트를 실제 JSON provider 로 렌더링해도 연결 키가 나온다(GROMO-2557).
        Map<String, Object> rendered = Json.map(new ObservationJsonProvider(new MockEnvironment()
                .withProperty("OBS_SERVICE", "notification")).format(first));
        assertThat(rendered).containsEntry("event_name", "consumer.accept").containsEntry("event_id", traced)
                .containsEntry("origin_request_id", "req-origin").containsEntry("origin_trace_id", trace)
                .containsEntry("delivery_id", "relay-delivery-1").containsEntry("attempt", 2);
        assertThat(second.getThreadName()).as("같은 리스너 스레드가 이어서 처리했다").isEqualTo(first.getThreadName());
        assertThat(second.getMDCPropertyMap()).as("앞 레코드의 문맥이 다음 레코드에 새지 않는다")
                .containsEntry("event_id", legacy)
                .doesNotContainKeys("origin_request_id", "origin_trace_id", "delivery_id", "attempt");
    }

    @Test
    void redeliveryWithOtherHeadersKeepsTheFirstOrigin() throws Exception {
        UUID user = UUID.randomUUID();
        String eventId = "kafka-redelivery-" + UUID.randomUUID();
        String payload = request(eventId, user);
        kafka.send(new ProducerRecord<>("notification-events", 1, user.toString(), payload,
                carrier("req-first", eventId, "1"))).get(10, TimeUnit.SECONDS);
        kafka.send(new ProducerRecord<>("notification-events", 1, user.toString(), payload,
                carrier("req-second", eventId, "2"))).get(10, TimeUnit.SECONDS);

        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> assertThat(acceptLogs(eventId))
                .extracting(ILoggingEvent::getFormattedMessage)
                .satisfiesExactly(m -> assertThat(m).contains("result=accepted"),
                        m -> assertThat(m).contains("result=duplicate")));
        assertThat(store.rows("SELECT origin_request_id FROM deliveries WHERE event_id=?", eventId))
                .singleElement().satisfies(row -> assertThat(row).containsEntry("origin_request_id", "req-first"));
        assertThat(acceptLogs(eventId).get(1).getMDCPropertyMap())
                .as("중복 수신 로그는 이번 시도의 relay 값으로 남는다").containsEntry("attempt", "2");
    }

    @Test
    void malformedOrUnknownCarrierIsIgnoredAndTheEventIsStillAccepted() throws Exception {
        UUID user = UUID.randomUUID();
        String malformed = "kafka-malformed-" + UUID.randomUUID();
        String unknownVersion = "kafka-unknown-version-" + UUID.randomUUID();
        List<Header> bad = new ArrayList<>(List.of(
                header("x-origin-request-id", "bad id\r\nforged: 1"),
                header("x-origin-trace-id", "f".repeat(65)),
                header("x-delivery-id", "../../etc"),
                header("x-attempt", "0"),
                header("x-trace-context-version", "1")));
        List<Header> future = carrier("req-v2", unknownVersion, "1");
        future.removeIf(h -> h.key().equals("x-trace-context-version"));
        future.add(header("x-trace-context-version", "2"));
        kafka.send(new ProducerRecord<>("notification-events", 1, user.toString(), request(malformed, user), bad))
                .get(10, TimeUnit.SECONDS);
        kafka.send(new ProducerRecord<>("notification-events", 1, user.toString(), request(unknownVersion, user),
                future)).get(10, TimeUnit.SECONDS);

        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> assertThat(
                store.rows("SELECT * FROM deliveries WHERE event_id IN (?,?)", malformed, unknownVersion)).hasSize(2));
        assertThat(store.rows("SELECT origin_request_id,origin_trace_id FROM deliveries WHERE event_id IN (?,?)",
                malformed, unknownVersion)).allSatisfy(row -> assertThat(row)
                .containsEntry("origin_request_id", null).containsEntry("origin_trace_id", null));
        assertThat(store.rows("SELECT * FROM inbound_events WHERE event_id IN (?,?)", malformed, unknownVersion))
                .hasSize(2);
        assertThat(acceptLog(malformed).getMDCPropertyMap())
                .doesNotContainKeys("origin_request_id", "origin_trace_id", "delivery_id", "attempt");
        assertThat(acceptLog(unknownVersion).getMDCPropertyMap()).doesNotContainKeys("origin_request_id", "attempt");
    }

    @Test
    void internalHttpAdoptsCarrierOnlyAfterServiceAuthAndFallsBackToRequestId() throws Exception {
        UUID user = UUID.randomUUID();
        String viaRequestId = "http-request-id-" + UUID.randomUUID();
        String viaOrigin = "http-origin-" + UUID.randomUUID();
        String unauthenticated = "http-unauth-" + UUID.randomUUID();

        mvc.perform(MockMvcRequestBuilders.post("/internal/events").header("Authorization", "Bearer test-data")
                        .header("X-Request-Id", "biz-req-1").contentType(MediaType.APPLICATION_JSON)
                        .content(request(viaRequestId, user)))
                .andExpect(status().isOk());
        mvc.perform(MockMvcRequestBuilders.post("/internal/events").header("Authorization", "Bearer test-data")
                        .header("X-Request-Id", "relay-own-request").header("X-Origin-Request-Id", "req-origin-http")
                        .header("X-Delivery-Id", "relay-delivery-9").header("X-Attempt", "1")
                        .header("X-Trace-Context-Version", "1").contentType(MediaType.APPLICATION_JSON)
                        .content(request(viaOrigin, user)))
                .andExpect(status().isOk());
        mvc.perform(MockMvcRequestBuilders.post("/internal/events").header("X-Origin-Request-Id", "req-forged")
                        .contentType(MediaType.APPLICATION_JSON).content(request(unauthenticated, user)))
                .andExpect(status().isUnauthorized());

        assertThat(store.one("SELECT origin_request_id FROM deliveries WHERE event_id=?", viaRequestId))
                .containsEntry("origin_request_id", "biz-req-1");
        assertThat(store.one("SELECT origin_request_id FROM deliveries WHERE event_id=?", viaOrigin))
                .as("origin 헤더가 요청 번호보다 우선한다").containsEntry("origin_request_id", "req-origin-http");
        assertThat(store.rows("SELECT * FROM deliveries WHERE event_id=?", unauthenticated)).isEmpty();
        assertThat(acceptLog(viaOrigin).getMDCPropertyMap()).containsEntry("delivery_id", "relay-delivery-9")
                .containsEntry("event_id", viaOrigin);
        assertThat(MDC.get("origin_request_id")).as("요청 처리 스레드(테스트 스레드)에 문맥이 남지 않는다").isNull();
    }

    private static String request(String eventId, UUID user) {
        return Json.write(NotificationStoreTest.event(eventId, "notification.requested", user, 1, null,
                Map.of("kind", "FRIEND_REQUEST")));
    }

    /** relay 가 싣는 carrier 헤더 — 이름은 소문자(로그 계약 §3). */
    private static List<Header> carrier(String origin, String eventId, String attempt) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("x-origin-request-id", origin);
        values.put("x-event-id", eventId);
        values.put("x-delivery-id", "relay-delivery-1");
        values.put("x-attempt", attempt);
        values.put("x-trace-context-version", "1");
        List<Header> headers = new ArrayList<>();
        values.forEach((name, value) -> headers.add(header(name, value)));
        return headers;
    }

    private static Header header(String name, String value) {
        return new RecordHeader(name, value.getBytes(StandardCharsets.UTF_8));
    }

    private static String header(Header header) {
        return header == null ? null : new String(header.value(), StandardCharsets.UTF_8);
    }

    private List<ILoggingEvent> acceptLogs(String eventId) {
        List<ILoggingEvent> snapshot;
        synchronized (accepts) {   // AppenderBase.doAppend 와 같은 잠금 — 리스너 스레드의 추가와 겹치지 않게
            snapshot = new ArrayList<>(accepts.list);
        }
        return snapshot.stream().filter(e -> eventId.equals(e.getMDCPropertyMap().get("event_id"))).toList();
    }

    private ILoggingEvent acceptLog(String eventId) {
        await().atMost(Duration.ofSeconds(10)).until(() -> !acceptLogs(eventId).isEmpty());
        return acceptLogs(eventId).get(0);
    }

    private KafkaConsumer<String, String> consumer() {
        return new KafkaConsumer<>(Map.of(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers(),
                ConsumerConfig.GROUP_ID_CONFIG, "dlt-test-" + UUID.randomUUID(),
                ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false), new StringDeserializer(), new StringDeserializer());
    }
}
