package com.oneorthree.notification;

import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.kafka.core.KafkaTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.kafka.KafkaContainer;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
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
    @MockitoBean PushTransport transport;

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
        kafka.send("notification-events", 2, user.toString(), unsupported).get(10, TimeUnit.SECONDS);
        try (KafkaConsumer<String, String> dlt = consumer()) {
            TopicPartition partition = new TopicPartition("notification-events.DLT", 2);
            dlt.assign(List.of(partition));
            dlt.seekToBeginning(List.of(partition));
            await().atMost(Duration.ofSeconds(25)).untilAsserted(() -> {
                var records = dlt.poll(Duration.ofMillis(500));
                assertThat(records.records(partition)).anySatisfy(record -> assertThat(record.value()).isEqualTo(unsupported));
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

    private KafkaConsumer<String, String> consumer() {
        return new KafkaConsumer<>(Map.of(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers(),
                ConsumerConfig.GROUP_ID_CONFIG, "dlt-test-" + UUID.randomUUID(),
                ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false), new StringDeserializer(), new StringDeserializer());
    }
}
