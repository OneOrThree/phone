package com.oneorthree.realtime.event;

import com.oneorthree.realtime.RestrictedRedisTestcontainersConfiguration;
import com.oneorthree.realtime.logging.CapturedLogs;
import com.oneorthree.realtime.logging.LogContext;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Header;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.FixedHostPortGenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;

import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실브로커 경계 (GROMO-2583) — 단일 노드 KRaft Kafka(운영 오버레이와 같은 apache/kafka 이미지)에 실제 리스너 컨테이너가
 * 붙어, ① 소비 스레드의 수신 scope 가 레코드 헤더의 원인 문맥을 달고 ② 3회 재시도 뒤 {@code .DLT} 로 넘어간 레코드가
 * 원본 carrier 헤더를 그대로 보존하는지 본다. 리스너를 직접 부르는 {@link InboundEventServiceTest} 와 달리 에러 핸들러·
 * DLT 발행기·ack 가 전부 실제 경로다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(RestrictedRedisTestcontainersConfiguration.class)
class KafkaBrokerBoundaryTest {

    private static final String TOPIC = "realtime-events";
    private static final String DLT = TOPIC + ".DLT";
    private static final int HOST_PORT = freePort();

    // 광고 주소에 호스트 포트가 들어가야 해서 고정 매핑을 쓴다. 의존성 추가 없이 testcontainers 코어만 쓴다.
    private static final FixedHostPortGenericContainer<?> KAFKA = new FixedHostPortGenericContainer<>(
            DockerImageName.parse("apache/kafka:3.8.1").asCanonicalNameString())
            .withFixedExposedPort(HOST_PORT, 9092)
            .withEnv("KAFKA_NODE_ID", "1")
            .withEnv("KAFKA_PROCESS_ROLES", "broker,controller")
            .withEnv("KAFKA_CONTROLLER_QUORUM_VOTERS", "1@localhost:9093")
            .withEnv("KAFKA_LISTENERS", "PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093")
            .withEnv("KAFKA_ADVERTISED_LISTENERS", "PLAINTEXT://localhost:" + HOST_PORT)
            .withEnv("KAFKA_LISTENER_SECURITY_PROTOCOL_MAP", "PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT")
            .withEnv("KAFKA_CONTROLLER_LISTENER_NAMES", "CONTROLLER")
            .withEnv("KAFKA_INTER_BROKER_LISTENER_NAME", "PLAINTEXT")
            .withEnv("KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", "1")
            .withEnv("KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR", "1")
            .withEnv("KAFKA_TRANSACTION_STATE_LOG_MIN_ISR", "1")
            .withEnv("KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS", "0")
            .waitingFor(Wait.forLogMessage(".*Kafka Server started.*", 1).withStartupTimeout(Duration.ofSeconds(90)));

    static {
        KAFKA.start();
    }

    @DynamicPropertySource
    static void kafka(DynamicPropertyRegistry registry) {
        registry.add("realtime.events.kafka-enabled", () -> "true");
        registry.add("spring.kafka.bootstrap-servers", KafkaBrokerBoundaryTest::bootstrap);
    }

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("브로커로 온 레코드의 carrier 헤더가 소비 스레드 수신 scope 에 실리고, 적용 실패 레코드는 재시도 뒤 DLT 로 같은 헤더를 달고 넘어간다 (GROMO-2583)")
    void carrierSurvivesConsumeAndDeadLetter() throws Exception {
        createTopics();
        UUID okUser = UUID.randomUUID();
        UUID badUser = UUID.randomUUID();
        String ok = withdrawn(okUser, "2");
        String broken = withdrawn(badUser, "\"x\"");
        Map<String, String> okCarrier = carrier("req-ok", "111", "user.withdrawn:" + okUser, "d-ok", "1");
        Map<String, String> badCarrier = carrier("req-bad", "222", "user.withdrawn:" + badUser, "d-bad", "3");

        try (CapturedLogs logs = CapturedLogs.of(InboundAcceptLog.class)) {
            send(ok, okCarrier);
            send(broken, badCarrier);

            // 수신 scope: 소비자 스레드의 MDC 에 헤더 값이 실린다.
            List<CapturedLogs.Line> acceptedLines = logs.await(CapturedLogs.event(LogContext.CONSUMER_ACCEPT,
                    "result=accepted").and(l -> "req-ok".equals(l.get("origin_request_id"))), 1, 30_000);
            assertThat(acceptedLines).as("수신 로그가 오지 않음").isNotEmpty();
            CapturedLogs.Line accepted = acceptedLines.get(0);
            assertThat(accepted.mdc()).containsEntry("origin_trace_id", "111")
                    .containsEntry("event_id", "user.withdrawn:" + okUser).containsEntry("delivery_id", "d-ok")
                    .containsEntry("attempt", "1");
            assertThat(accepted.thread()).as("HTTP 스레드가 아니라 리스너 컨테이너 스레드").contains("ntainer");

            // 실패: 첫 시도 + 재시도 3회가 모두 같은 원인 문맥으로 찍힌다.
            List<CapturedLogs.Line> failed = logs.await(CapturedLogs.event(LogContext.CONSUMER_ACCEPT,
                    "result=failed").and(l -> "req-bad".equals(l.get("origin_request_id"))), 4, 30_000);
            assertThat(failed).hasSize(4).allSatisfy(l -> assertThat(l.mdc())
                    .containsEntry("event_id", "user.withdrawn:" + badUser).containsEntry("attempt", "3"));
        }

        ConsumerRecord<String, String> dead = awaitDeadLetter("user.withdrawn:" + badUser);
        assertThat(dead.value()).isEqualTo(broken);
        badCarrier.forEach((name, value) -> assertThat(lastHeader(dead, name)).as(name).isEqualTo(value));
        // DLT 발행기는 진단 헤더(kafka_dlt-*)를 «더할 뿐» carrier 를 바꾸지 않는다.
        assertThat(lastHeader(dead, "kafka_dlt-original-topic")).isEqualTo(TOPIC);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inbound_events WHERE event_id = ?", Long.class,
                "user.withdrawn:" + badUser)).as("실패한 적용은 수신 기록이 롤백된다").isZero();
    }

    private static String bootstrap() {
        return KAFKA.getHost() + ":" + HOST_PORT;
    }

    private static void createTopics() throws Exception {
        try (AdminClient admin = AdminClient.create(Map.<String, Object>of("bootstrap.servers", bootstrap()))) {
            admin.createTopics(List.of(new NewTopic(TOPIC, 1, (short) 1), new NewTopic(DLT, 1, (short) 1))).all()
                    .get();
        } catch (java.util.concurrent.ExecutionException e) {
            if (!(e.getCause() instanceof org.apache.kafka.common.errors.TopicExistsException)) {
                throw e;
            }
        }
    }

    private static void send(String value, Map<String, String> carrier) throws Exception {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap());
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
            ProducerRecord<String, String> record = new ProducerRecord<>(TOPIC, 0, null, value);
            carrier.forEach((name, v) -> record.headers().add(name, v.getBytes(StandardCharsets.UTF_8)));
            producer.send(record).get();
        }
    }

    private static ConsumerRecord<String, String> awaitDeadLetter(String eventIdPart) {
        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap());
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
            TopicPartition partition = new TopicPartition(DLT, 0);
            consumer.assign(List.of(partition));
            consumer.seekToBeginning(List.of(partition));
            long deadline = System.currentTimeMillis() + 30_000;
            while (System.currentTimeMillis() < deadline) {
                for (ConsumerRecord<String, String> record : consumer.poll(Duration.ofMillis(500))) {
                    if (record.value().contains(eventIdPart)) {
                        return record;
                    }
                }
            }
        }
        throw new AssertionError("DLT 에 레코드가 오지 않았다: " + eventIdPart);
    }

    private static String lastHeader(ConsumerRecord<String, String> record, String name) {
        Header header = record.headers().lastHeader(name);
        return header == null ? null : new String(header.value(), StandardCharsets.UTF_8);
    }

    private static Map<String, String> carrier(String request, String trace, String eventId, String delivery,
            String attempt) {
        Map<String, String> carrier = new LinkedHashMap<>();
        carrier.put("x-origin-request-id", request);
        carrier.put("x-origin-trace-id", trace);
        carrier.put("x-event-id", eventId);
        carrier.put("x-delivery-id", delivery);
        carrier.put("x-attempt", attempt);
        carrier.put("x-trace-context-version", "1");
        return carrier;
    }

    private static String withdrawn(UUID user, String generationJson) {
        return "{\"eventId\":\"user.withdrawn:" + user + "\",\"schemaVersion\":1,\"type\":\"user.withdrawn\","
                + "\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":\"" + user + "\",\"version\":7,"
                + "\"params\":{\"userId\":\"" + user + "\",\"authGeneration\":" + generationJson + "}}";
    }

    private static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
