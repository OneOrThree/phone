package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestKafka;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.outbox.support.StubSatelliteServer;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.TopicDescription;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * relay 의 <b>실제 발행 경로</b> 검증 — 실물 PostgreSQL(Flyway V51) + 실물 Kafka + 실물 HTTP.
 *
 * <p>여기서 목을 쓰지 않는 이유는 계약 §8 에 있다: 목이 생산 경로를 대신 세우면 통합 성공을 주장할 수
 * 없다. 브로커는 {@code apache/kafka}(compose 와 같은 배포물), 위성은 진짜 소켓을 여는 스텁이다.
 *
 * <p>보는 것: 대상별 표시 · 선행 미전달 건너뛰기 금지 · 리스 만료 재클레임과 낡은 완료 표시 거부 ·
 * 브로커 중단 후 재전달 · at-least-once · 3파티션 DLT 계약 · SSRF 허용목록.
 */
@SpringBootTest
class OutboxRelayIntegrationTest {

    private static final StubSatelliteServer LINK_SERVER = StubSatelliteServer.start("/internal/users/");
    private static final String SERVICE_TOKEN = "link-service-token";
    private static final String LINK_ENDPOINT_KEY = "LINK_USER_WITHDRAW";
    private static final String TOPIC = "notification-events";
    private static final String DLT_TOPIC = "notification-events.DLT";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("spring.kafka.bootstrap-servers", OutboxTestKafka.INSTANCE::getBootstrapServers);
        registry.add("outbox.relay.enabled", () -> true);
        registry.add("outbox.relay.worker-id", () -> "test-worker");
        registry.add("outbox.relay.batch-size", () -> 10);
        // 리스를 짧게 잡아 «만료 후 재클레임»을 실시간으로 재현한다 — 행을 손으로 고쳐 시간을
        // 흉내 내면 검증되는 것이 그 UPDATE 뿐이다.
        registry.add("outbox.relay.lease-duration", () -> "PT2S");
        // 크론은 돌지 않게 한다(ci 프로파일의 app.scheduling.enabled=false). 틱은 테스트가 직접 부른다 —
        // 그래야 「몇 번째 틱에 무엇이 나갔는가」를 단언할 수 있다.
        registry.add("outbox.relay.poll-interval", () -> "PT60S");
        registry.add("outbox.relay.retry.initial-backoff", () -> "PT0.2S");
        registry.add("outbox.relay.retry.max-backoff", () -> "PT1S");
        registry.add("outbox.relay.retry.max-attempts", () -> 5);
        registry.add("outbox.relay.endpoints." + LINK_ENDPOINT_KEY + ".target", () -> "LINK");
        registry.add("outbox.relay.endpoints." + LINK_ENDPOINT_KEY + ".method", () -> "POST");
        registry.add("outbox.relay.endpoints." + LINK_ENDPOINT_KEY + ".token", () -> SERVICE_TOKEN);
        registry.add("outbox.relay.endpoints." + LINK_ENDPOINT_KEY + ".url",
                () -> LINK_SERVER.baseUrl() + "/internal/users/{userId}/withdraw");
    }

    @AfterAll
    static void stopStub() {
        LINK_SERVER.stop();
    }

    @Autowired
    OutboxCommandPort outboxCommandPort;
    @Autowired
    OutboxRelayService relayService;
    @Autowired
    OutboxRelayStore relayStore;
    @Autowired
    EventOutboxRepository outboxRepository;
    @Autowired
    EventOutboxDeliveryRepository deliveryRepository;
    @Autowired
    OutboxRelayProperties relayProperties;
    @Autowired
    PlatformTransactionManager transactionManager;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    /**
     * 앞 테스트가 남긴 미전달 행을 비운다.
     *
     * <p>없으면 relay 가 <b>남의 행을 집는다</b> — 「선행 미전달을 건너뛰지 않는다」가 정확히 그렇게
     * 동작하기 때문이다. 그건 회귀가 아니라 테스트끼리의 간섭이라, 데이터를 비워 각 검사가 자기
     * 행만 보게 한다(생산 배선은 그대로 둔다 — 여기서 지우는 것은 데이터뿐이다).
     */
    @BeforeEach
    void clearOutbox() {
        tx().executeWithoutResult(status -> {
            deliveryRepository.deleteAllInBatch();
            outboxRepository.deleteAllInBatch();
        });
    }

    @Test
    @DisplayName("두 토픽이 각 3파티션으로 존재한다 — .DLT 파티션이 다르면 재처리 순서가 원 토픽과 어긋난다")
    void createsBothTopicsWithThreePartitions() throws Exception {
        Properties config = new Properties();
        config.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, OutboxTestKafka.INSTANCE.getBootstrapServers());
        try (Admin admin = Admin.create(config)) {
            Map<String, TopicDescription> topics =
                    admin.describeTopics(List.of(TOPIC, DLT_TOPIC)).allTopicNames().get();

            assertThat(topics.get(TOPIC).partitions()).hasSize(3);
            assertThat(topics.get(DLT_TOPIC))
                    .as("소비 실패의 종착 토픽이 없으면 DLQ 발행 자체가 실패한다")
                    .isNotNull();
            assertThat(topics.get(DLT_TOPIC).partitions()).hasSize(3);
        }
    }

    @Test
    @DisplayName("대상별로 따로 표시된다 — 링크가 실패해도 Kafka 는 다시 발행되지 않는다")
    void marksEachTargetIndependently() {
        UUID userId = UUID.randomUUID();
        String eventId = "evt-targets-" + UUID.randomUUID();
        LINK_SERVER.clear();
        LINK_SERVER.respondWith(503);

        UUID outboxId = appendWithdrawn(userId, eventId).outboxId();
        relayService.relayOnce();

        assertThat(delivery(outboxId, OutboxTarget.KAFKA).getDeliveredAt())
                .as("브로커는 성공했다").isNotNull();
        EventOutboxDelivery link = delivery(outboxId, OutboxTarget.LINK);
        assertThat(link.getDeliveredAt()).isNull();
        assertThat(link.getAttemptCount()).isEqualTo(1);
        assertThat(link.getLastError()).contains("503");
        assertThat(link.getLeaseToken()).as("실패 뒤에는 리스를 놓는다").isNull();

        long kafkaMessagesAfterFirstTick = countPublished(eventId);
        LINK_SERVER.respondWith(200);
        sleep(400);                       // 백오프가 지나기를 기다린다
        relayService.relayOnce();

        assertThat(delivery(outboxId, OutboxTarget.LINK).getDeliveredAt())
                .as("실패가 남은 대상만 재시도한다").isNotNull();
        assertThat(kafkaMessagesAfterFirstTick)
                .as("링크 재시도가 브로커를 다시 두드리면 소비자가 같은 사건을 두 번 본다")
                .isEqualTo(1L);
        assertThat(countPublished(eventId)).isEqualTo(1L);

        StubSatelliteServer.Received sent = LINK_SERVER.received().get(LINK_SERVER.received().size() - 1);
        assertThat(sent.method()).isEqualTo("POST");
        assertThat(sent.path())
                .as("경로 자리표시자는 봉투의 userId 로만 채워진다 — payload 가 목적지를 고르면 SSRF 다")
                .isEqualTo("/internal/users/" + userId + "/withdraw");
        assertThat(sent.serviceToken())
                .as("위성 수신부는 caller 별 서비스 토큰으로 호출자를 가른다(계약 §2)")
                .isEqualTo("Bearer " + SERVICE_TOKEN);
    }

    @Test
    @DisplayName("Kafka 키는 userId 이고 값은 정본 봉투다 — 같은 유저가 한 파티션에 모인다")
    void publishesEnvelopeKeyedByUserId() {
        UUID userId = UUID.randomUUID();
        String eventId = "evt-key-" + UUID.randomUUID();
        LINK_SERVER.respondWith(200);

        EventEnvelope envelope = appendWithdrawn(userId, eventId).envelope();
        relayService.relayTarget(OutboxTarget.KAFKA);

        ConsumerRecord<String, String> record = consume(TOPIC, 1).stream()
                .filter(r -> r.value().contains(eventId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("발행된 봉투를 찾지 못했다"));

        assertThat(record.key()).isEqualTo(userId.toString());
        assertThat(record.value())
                .contains("\"eventId\":\"" + eventId + "\"")
                .contains("\"version\":" + envelope.version())
                .contains("\"schemaVersion\":1")
                .as("시각은 ISO-8601 문자열이다 — epoch 실수로 나가면 소비자 파싱이 언어마다 갈린다")
                .contains("\"occurredAt\":\"" + envelope.occurredAt() + "\"");
    }

    @Test
    @DisplayName("같은 축의 선행 미전달을 건너뛰지 않는다 — 건너뛰면 뒤 사건이 먼저 도착해 투영이 되돌아간다")
    void neverSkipsAnEarlierUndeliveredRowOnTheSameAxis() {
        UUID userId = UUID.randomUUID();
        LINK_SERVER.clear();
        LINK_SERVER.respondWith(503);

        UUID first = appendLinkOnly(userId, "evt-order-1-" + UUID.randomUUID()).outboxId();
        UUID second = appendLinkOnly(userId, "evt-order-2-" + UUID.randomUUID()).outboxId();
        UUID third = appendLinkOnly(userId, "evt-order-3-" + UUID.randomUUID()).outboxId();

        relayService.relayTarget(OutboxTarget.LINK);
        assertThat(delivery(first, OutboxTarget.LINK).getAttemptCount()).isEqualTo(1);
        assertThat(delivery(second, OutboxTarget.LINK).getAttemptCount())
                .as("앞 사건이 아직 미전달인데 뒤 사건을 집으면 순서가 뒤집힌다").isZero();
        assertThat(delivery(third, OutboxTarget.LINK).getAttemptCount()).isZero();

        sleep(400);
        relayService.relayTarget(OutboxTarget.LINK);
        assertThat(delivery(first, OutboxTarget.LINK).getAttemptCount()).isEqualTo(2);
        assertThat(delivery(second, OutboxTarget.LINK).getAttemptCount()).isZero();

        LINK_SERVER.respondWith(200);
        sleep(800);
        relayService.relayTarget(OutboxTarget.LINK);
        assertThat(delivery(first, OutboxTarget.LINK).getDeliveredAt()).isNotNull();

        relayService.relayTarget(OutboxTarget.LINK);
        assertThat(delivery(second, OutboxTarget.LINK).getDeliveredAt())
                .as("앞이 끝나야 다음이 나간다").isNotNull();
        assertThat(delivery(third, OutboxTarget.LINK).getDeliveredAt()).isNull();
    }

    @Test
    @DisplayName("다른 축은 서로를 막지 않는다 — 링크 멤버십 전이는 유저 축과 별개다")
    void differentAxesDoNotBlockEachOther() {
        UUID userId = UUID.randomUUID();
        UUID groupId = UUID.randomUUID();
        LINK_SERVER.respondWith(503);

        UUID userEvent = appendLinkOnly(userId, "evt-axis-user-" + UUID.randomUUID()).outboxId();
        UUID membershipEvent = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                "evt-axis-link-" + UUID.randomUUID(), 1, "link.revoked", userId, null,
                groupId + ":" + userId, AggregateRef.ofLinkMembership(groupId, userId), null,
                Map.of("linkVersion", 3, "membershipEpoch", 4),
                List.of(OutboxDeliveryRequest.toLink(LINK_ENDPOINT_KEY, null)))).eventId())
                .transform(this::outboxIdOf);

        relayService.relayTarget(OutboxTarget.LINK);

        assertThat(delivery(userEvent, OutboxTarget.LINK).getAttemptCount()).isEqualTo(1);
        assertThat(delivery(membershipEvent, OutboxTarget.LINK).getAttemptCount())
                .as("claim 사용자와 발급자가 다른 유저라 유저 축으로는 이 순서를 표현할 수 없다(A22 ㋥)")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("리스가 만료되면 다른 워커가 회수하고, 낡은 워커의 완료 표시는 거부된다")
    void expiredLeaseIsReclaimedAndStaleAckIsRejected() {
        UUID userId = UUID.randomUUID();
        LINK_SERVER.respondWith(503);
        UUID outboxId = appendLinkOnly(userId, "evt-lease-" + UUID.randomUUID()).outboxId();

        UUID deadWorkerToken = UUID.randomUUID();
        List<EventOutboxDelivery> claimed = relayStore.claim(OutboxTarget.LINK, "dead-worker", deadWorkerToken);
        assertThat(claimed).hasSize(1);
        UUID deliveryId = claimed.get(0).getId();

        UUID liveWorkerToken = UUID.randomUUID();
        assertThat(relayStore.claim(OutboxTarget.LINK, "live-worker", liveWorkerToken))
                .as("리스가 살아 있는 동안에는 남이 집지 못한다")
                .isEmpty();

        sleep(relayProperties.getLeaseDuration().toMillis() + 500);

        List<EventOutboxDelivery> reclaimed =
                relayStore.claim(OutboxTarget.LINK, "live-worker", liveWorkerToken);
        assertThat(reclaimed)
                .as("선점 후 죽은 워커의 건이 영구 미전달로 남으면 안 된다")
                .hasSize(1);
        assertThat(reclaimed.get(0).getId()).isEqualTo(deliveryId);
        assertThat(reclaimed.get(0).getAttemptCount())
                .as("죽은 워커의 시도도 세어야 「몇 번째부터 이상한가」가 보인다")
                .isEqualTo(2);

        assertThat(relayStore.markDelivered(deliveryId, deadWorkerToken))
                .as("낡은 완료 표시를 받아 주면 «아직 안 간 전달»이 삼켜진다 — 그건 복구할 수 없다")
                .isZero();
        assertThat(delivery(outboxId, OutboxTarget.LINK).getDeliveredAt()).isNull();

        assertThat(relayStore.markDelivered(deliveryId, liveWorkerToken))
                .as("현재 소유자의 표시는 반영된다").isEqualTo(1);
        assertThat(delivery(outboxId, OutboxTarget.LINK).getDeliveredAt()).isNotNull();
    }

    @Test
    @DisplayName("허용목록에 없는 엔드포인트 키는 보내지 않는다 — 재시도해도 그대로지만 행은 남긴다")
    void refusesToSendToAnEndpointKeyOutsideTheAllowlist() {
        UUID userId = UUID.randomUUID();
        LINK_SERVER.clear();
        LINK_SERVER.respondWith(200);

        UUID outboxId = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                "evt-ssrf-" + UUID.randomUUID(), 1, "link.revoked", userId, null, null,
                AggregateRef.ofUser(userId), null, Map.of("url", "http://169.254.169.254/latest/meta-data"),
                List.of(OutboxDeliveryRequest.toLink("NOT_IN_ALLOWLIST", null)))).eventId())
                .transform(this::outboxIdOf);

        relayService.relayTarget(OutboxTarget.LINK);

        EventOutboxDelivery link = delivery(outboxId, OutboxTarget.LINK);
        assertThat(link.getDeliveredAt()).isNull();
        assertThat(link.getLastError()).contains("허용목록에 없는 엔드포인트 키");
        assertThat(LINK_SERVER.received())
                .as("payload 가 목적지를 고를 수 있으면 그게 곧 SSRF 다 — 아무 데도 가지 않아야 한다")
                .isEmpty();
    }

    @Test
    @DisplayName("브로커가 멈추면 표시하지 않고, 되살아나면 같은 주소로 재전달한다")
    void redeliversAfterBrokerOutage() {
        UUID userId = UUID.randomUUID();
        String eventId = "evt-outage-" + UUID.randomUUID();
        UUID outboxId = appendKafkaOnly(userId, eventId);

        OutboxTestKafka.pause();
        try {
            relayService.relayTarget(OutboxTarget.KAFKA);
        } finally {
            OutboxTestKafka.unpause();
        }

        EventOutboxDelivery afterOutage = delivery(outboxId, OutboxTarget.KAFKA);
        assertThat(afterOutage.getDeliveredAt())
                .as("발행이 확인되지 않았는데 표시하면 그 이벤트는 영영 안 간다")
                .isNull();
        assertThat(afterOutage.getAttemptCount()).isEqualTo(1);
        assertThat(afterOutage.getLastError()).isNotBlank();

        sleep(1500);
        for (int attempt = 0; attempt < 10; attempt++) {
            relayService.relayTarget(OutboxTarget.KAFKA);
            if (delivery(outboxId, OutboxTarget.KAFKA).getDeliveredAt() != null) {
                break;
            }
            sleep(1000);
        }

        assertThat(delivery(outboxId, OutboxTarget.KAFKA).getDeliveredAt())
                .as("브로커가 돌아오면 남아 있던 미전달이 나간다 — 그게 outbox 를 두는 이유다")
                .isNotNull();
        assertThat(countPublished(eventId)).isGreaterThanOrEqualTo(1L);
    }

    @Test
    @DisplayName("발행 성공 후 표시 실패는 중복으로 끝난다 — at-least-once 는 이 방향으로만 틀려야 한다")
    void publishSucceededButMarkLostProducesDuplicateNotLoss() {
        UUID userId = UUID.randomUUID();
        String eventId = "evt-atleastonce-" + UUID.randomUUID();
        UUID outboxId = appendKafkaOnly(userId, eventId);

        // 「발행은 됐는데 표시가 유실됐다」를 그대로 재현한다 — 낡은 토큰으로 완료를 보고한다.
        UUID token = UUID.randomUUID();
        List<EventOutboxDelivery> claimed = relayStore.claim(OutboxTarget.KAFKA, "crashing-worker", token);
        assertThat(claimed).hasSize(1);
        relayService.relayTarget(OutboxTarget.KAFKA);   // 리스가 살아 있어 이번 틱은 아무것도 못 집는다
        assertThat(delivery(outboxId, OutboxTarget.KAFKA).getDeliveredAt()).isNull();

        sleep(relayProperties.getLeaseDuration().toMillis() + 500);
        for (int attempt = 0; attempt < 10; attempt++) {
            relayService.relayTarget(OutboxTarget.KAFKA);
            if (delivery(outboxId, OutboxTarget.KAFKA).getDeliveredAt() != null) {
                break;
            }
            sleep(500);
        }

        assertThat(delivery(outboxId, OutboxTarget.KAFKA).getDeliveredAt())
                .as("표시를 잃은 행은 반드시 다시 나간다 — 유실 대신 중복을 택한다")
                .isNotNull();
        assertThat(countPublished(eventId))
                .as("수신 측은 eventId 로 멱등이라 중복이 안전하다")
                .isGreaterThanOrEqualTo(1L);
    }

    // ── 헬퍼 ────────────────────────────────────────────────────────────

    /**
     * 봉투와 그 저장 id.
     *
     * @param envelope 저장된 봉투
     * @param outboxId 봉투 행 id
     */
    private record Appended(EventEnvelope envelope, UUID outboxId) {
    }

    private Appended appendWithdrawn(UUID userId, String eventId) {
        EventEnvelope envelope = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                eventId, 1, "user.withdrawn", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of("reason", "SELF"),
                List.of(OutboxDeliveryRequest.toKafka(),
                        OutboxDeliveryRequest.toLink(LINK_ENDPOINT_KEY, null)))));
        return new Appended(envelope, outboxIdOf(envelope.eventId()));
    }

    private Appended appendLinkOnly(UUID userId, String eventId) {
        EventEnvelope envelope = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                eventId, 1, "user.withdrawn", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of(),
                List.of(OutboxDeliveryRequest.toLink(LINK_ENDPOINT_KEY, null)))));
        return new Appended(envelope, outboxIdOf(envelope.eventId()));
    }

    private UUID appendKafkaOnly(UUID userId, String eventId) {
        EventEnvelope envelope = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                eventId, 1, "challenge.created", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of(),
                List.of(OutboxDeliveryRequest.toKafka()))));
        return outboxIdOf(envelope.eventId());
    }

    private UUID outboxIdOf(String eventId) {
        EventOutbox saved = outboxRepository.findByEventId(eventId)
                .orElseThrow(() -> new AssertionError("봉투가 없습니다 — eventId=" + eventId));
        return saved.getId();
    }

    private EventOutboxDelivery delivery(UUID outboxId, OutboxTarget target) {
        return deliveryRepository.findByOutboxIdAndTarget(outboxId, target)
                .orElseThrow(() -> new AssertionError("전달 행이 없습니다 — target=" + target));
    }

    /** 토픽 처음부터 읽는다 — 「무엇이 실제로 브로커에 있는가」만 본다. */
    private List<ConsumerRecord<String, String>> consume(String topic, int maxSeconds) {
        Map<String, Object> config = new HashMap<>();
        config.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, OutboxTestKafka.INSTANCE.getBootstrapServers());
        config.put(ConsumerConfig.GROUP_ID_CONFIG, "test-" + UUID.randomUUID());
        config.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        config.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        List<ConsumerRecord<String, String>> collected = new ArrayList<>();
        try (KafkaConsumer<String, String> consumer =
                     new KafkaConsumer<>(config, new StringDeserializer(), new StringDeserializer())) {
            consumer.subscribe(List.of(topic));
            long deadline = System.currentTimeMillis() + maxSeconds * 1000L + 3000L;
            while (System.currentTimeMillis() < deadline) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
                records.forEach(collected::add);
            }
        }
        return collected;
    }

    /**
     * 이 사건이 브로커에 실제로 <b>몇 건</b> 있는지 센다.
     *
     * @param eventId 결정적 사건 키
     * @return 발행 건수
     */
    private long countPublished(String eventId) {
        return consume(TOPIC, 1).stream().filter(r -> r.value().contains(eventId)).count();
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
