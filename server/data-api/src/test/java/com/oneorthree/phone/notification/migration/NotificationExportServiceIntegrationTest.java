package com.oneorthree.phone.notification.migration;

import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 이관 export — <b>게이트가 실제로 열리고 닫히는지</b>가 전부다.
 *
 * <h2>여기서만 확인할 수 있는 성질</h2>
 * <ul>
 *   <li><b>미발송 행이 게이트를 막지 않는다.</b> {@code PENDING}·{@code DEFERRED} 는 이관할
 *       «화물»이지 잔여가 아니다. 합계에 넣으면 0 이 되는 날이 영영 오지 않아 컷오버가 불가능해진다
 *       — 목으로는 이 구분이 드러나지 않는다.</li>
 *   <li><b>인플라이트 drain 확인 없이는 최종 export 가 안 나온다.</b> DB 로 알 수 없는 사실이라
 *       사람이 말해야 하고, 말하지 않으면 죽어야 한다.</li>
 *   <li><b>종결분도 producer 와 같은 키를 받는다.</b> 여기가 어긋나면 컷오버 뒤 재훑기가 같은
 *       사건을 새 키로 만들어 이미 나간 알림이 한 번 더 간다.</li>
 * </ul>
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class NotificationExportServiceIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    private static final String MIGRATION_ID = "test-cutover";
    private static final Instant SLOT = Instant.parse("2026-09-11T12:00:00Z");

    @Autowired
    NotificationExportService exportService;
    @Autowired
    UserRepository userRepository;
    @Autowired
    EntityManager entityManager;
    @Autowired
    PlatformTransactionManager transactionManager;

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder()
                .nickname("이관-" + UUID.randomUUID().toString().substring(0, 8))
                .language("ko")
                .build());
        // 같은 컨테이너를 쓰는 앞선 테스트가 남긴 «미전달 outbox» 를 닫는다. 그것이 남아 있으면
        // queueDepth 가 0 이 아니어서, 이 클래스가 검증하려는 게이트 조건이 남의 상태에 좌우된다.
        // (relay 는 테스트에서 꺼져 있으므로 아무도 이 행들을 내보내지 않는다.)
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery(
                                "UPDATE event_outbox_deliveries SET delivered_at = now() "
                                        + "WHERE delivered_at IS NULL")
                        .executeUpdate());
    }

    @AfterEach
    void tearDown() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery(
                                "DELETE FROM notification_sent_logs WHERE user_id = :userId")
                        .setParameter("userId", user.getId())
                        .executeUpdate());
        userRepository.delete(user);
    }

    /**
     * 구 발송 이력 한 줄을 직접 넣는다 — 엔티티 대신 네이티브 INSERT 를 쓰는 이유는, 이관이 읽는
     * 것이 <b>지금 코드가 만들 수 있는 행</b>이 아니라 <b>DB 에 이미 있는 행</b>이기 때문이다.
     *
     * @param kind   구 {@code kind} 컬럼
     * @param status {@code PENDING} · {@code DEFERRED} · {@code SENT}
     * @param sentAt 실발송 시각. 미발송이면 {@code null}
     */
    private void insertLog(String kind, String status, Instant sentAt) {
        new TransactionTemplate(transactionManager).executeWithoutResult(state ->
                entityManager.createNativeQuery("""
                                INSERT INTO notification_sent_logs
                                    (id, user_id, type, kind, subject_id, target_user_id,
                                     sent_at, claimed_at, status, group_id, slot_at, next_attempt_at)
                                VALUES (:id, :userId, :kind, :kind, NULL, NULL,
                                        :sentAt, :claimedAt, :status, NULL, :slotAt, NULL)
                                """)
                        .setParameter("id", UUID.randomUUID())
                        .setParameter("userId", user.getId())
                        .setParameter("kind", kind)
                        .setParameter("sentAt", sentAt)
                        .setParameter("claimedAt", SLOT)
                        .setParameter("status", status)
                        .setParameter("slotAt", SLOT)
                        .executeUpdate());
    }

    private List<NotificationMigrationRecord> deliveriesOf(NotificationExportDocument document) {
        return document.records().stream()
                .filter(record -> NotificationMigrationRecord.RESOURCE_DELIVERY.equals(record.resource()))
                .filter(record -> user.getId().toString().equals(record.data().get("userId")))
                .toList();
    }

    @Test
    @DisplayName("미발송 행은 잔여가 아니라 «화물»이다 — queueDepth 에 들어가면 컷오버가 영영 불가능해진다")
    void unsentRowsAreCargoNotResidue() {
        insertLog(NotificationKind.STREAK_AT_RISK.name(), "PENDING", null);
        insertLog(NotificationKind.MISSED_FOCUS_TODAY.name(), "DEFERRED", null);

        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        assertThat(document.report().queueBreakdown())
                .extractingByKey(NotificationExportService.PAYLOAD_KEY)
                .satisfies(payload -> assertThat(payload).isGreaterThanOrEqualTo(2L));
        // 화물이 합계에 섞이면 「미발송을 옮기려면 미발송이 0 이어야 한다」는 순환이 된다.
        assertThat(document.manifest().stopWindow().queueDepth()).isZero();
        assertThat(deliveriesOf(document)).hasSize(2);
    }

    @Test
    @DisplayName("정지 창을 닫았다면서 drain 확인이 없으면 죽는다 — DB 로는 알 수 없는 사실이다")
    void finalExportRequiresInflightDrainAttestation() {
        insertLog(NotificationKind.STREAK_AT_RISK.name(), "PENDING", null);

        assertThatThrownBy(() -> exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), false, true))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("inflight-drained");

        // 확인을 붙이면 통과한다 — 잔여 outbox 가 0 이기 때문이다.
        NotificationExportDocument document =
                exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, true);
        assertThat(document.report().inflightDrained()).isTrue();
        assertThat(document.report().finalEligible()).isTrue();
    }

    @Test
    @DisplayName("정지 창 없이 돈 탐색 export 는 최종본이 아니다 — 파일 이름으로는 구분되지 않으므로 표시가 필요하다")
    void exploratoryExportIsNotFinal() {
        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, true, true);

        assertThat(document.manifest().stopWindow().closedAt()).isNull();
        assertThat(document.report().finalEligible()).isFalse();
    }

    @Test
    @DisplayName("종결분도 producer 와 «같은 함수»로 키를 받는다 — 다르면 재훑기가 이미 나간 알림을 다시 보낸다")
    void sentRowsGetTheProducerKey() {
        insertLog(NotificationKind.STREAK_AT_RISK.name(), "SENT", SLOT.plusSeconds(60));

        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        String expected = NotificationEventKey.of(
                NotificationKind.STREAK_AT_RISK, user.getId(), null, SLOT);
        assertThat(deliveriesOf(document)).singleElement().satisfies(record -> {
            assertThat(record.recordKey()).isEqualTo(expected);
            assertThat(record.data()).containsEntry("eventId", expected)
                    .containsEntry("status", "SENT")
                    // 시각은 전부 epoch millis 정수다 — 봉투의 ISO-8601 과 다른 축이다.
                    .containsEntry("slotAt", SLOT.toEpochMilli())
                    .containsEntry("sentAt", SLOT.plusSeconds(60).toEpochMilli())
                    .containsEntry("locale", "ko");
        });
    }

    @Test
    @DisplayName("신 카탈로그에 없는 종류는 실패로 보고하고 게이트를 닫는다 — 모르는 것을 버리면 그게 곧 유실이다")
    void unknownKindFailsTheGate() {
        insertLog("SOMETHING_RETIRED", "PENDING", null);

        assertThatThrownBy(() -> exportService.export(MIGRATION_ID, null, false, true))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("재조립할 수 없는");

        NotificationExportDocument lenient = exportService.export(MIGRATION_ID, null, false, false);
        assertThat(lenient.failures()).anySatisfy(failure -> {
            assertThat(failure.legacyKind()).isEqualTo("SOMETHING_RETIRED");
            assertThat(failure.reason()).isEqualTo(NotificationExportService.FAIL_UNKNOWN_KIND);
        });
    }

    @Test
    @DisplayName("폐기된 RANK_OVERTAKE 는 실패가 아니라 «옮기지 않는다» — 신 producer 가 만들지 않아 중복 위험이 없다")
    void retiredRankOvertakeIsSkippedSilently() {
        insertLog(NotificationExportService.LEGACY_RANK_OVERTAKE, "SENT", SLOT);

        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        assertThat(deliveriesOf(document)).isEmpty();
        assertThat(document.failures()).noneSatisfy(failure ->
                assertThat(failure.legacyKind())
                        .isEqualTo(NotificationExportService.LEGACY_RANK_OVERTAKE));
    }

    @Test
    @DisplayName("manifest 는 자원 셋을 모두 갖고, 빈 자원도 체크섬을 갖는다")
    void manifestAlwaysCarriesAllThreeResources() {
        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        Map<String, NotificationMigrationManifest.ResourceDigest> resources =
                document.manifest().resources();
        assertThat(resources).containsOnlyKeys(
                NotificationMigrationRecord.RESOURCE_SETTINGS,
                NotificationMigrationRecord.RESOURCE_DEVICE,
                NotificationMigrationRecord.RESOURCE_DELIVERY);
        // 「행이 없다」와 「자원을 통째로 빠뜨렸다」가 구분돼야 한다.
        resources.values().forEach(digest -> assertThat(digest.checksum()).hasSize(64));
        assertThat(document.manifest().version()).isEqualTo(NotificationMigrationManifest.VERSION);
        assertThat(document.manifest().stopWindow().source())
                .isEqualTo(NotificationMigrationManifest.StopWindow.SOURCE);
    }

    @Test
    @DisplayName("cursor 는 시각이 아니라 커밋된 상태의 지문이다 — 같은 상태면 같은 값이 나온다")
    void cursorIsAStateFingerprintNotATimestamp() {
        String first = exportService.export(MIGRATION_ID, null, false, true)
                .manifest().stopWindow().cursor();
        String second = exportService.export(MIGRATION_ID, null, false, true)
                .manifest().stopWindow().cursor();

        assertThat(first).startsWith("av:").isEqualTo(second);
    }
}
