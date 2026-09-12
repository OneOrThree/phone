package com.oneorthree.phone.notification.migration;

import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.DefaultApplicationArguments;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
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
    private static final int STAKE = 30;
    private static final int GOAL_MINUTES = 60;

    @Autowired
    NotificationExportService exportService;
    @Autowired
    UserRepository userRepository;
    @Autowired
    EntityManager entityManager;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupChallengeRepository challengeRepository;
    @Autowired
    GroupChallengeDurationRepository challengeDurationRepository;
    @Autowired
    GroupChallengeBetRepository betRepository;
    @Autowired
    GroupChallengeBetSessionRepository sessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository participantRepository;

    private User user;
    private Group group;
    private final List<GroupChallengeBetSession> sessions = new ArrayList<>();
    private final List<GroupChallengeBet> bets = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<User> extraUsers = new ArrayList<>();

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
        sessions.forEach(session -> participantRepository
                .deleteAll(participantRepository.findBySessionIdIn(List.of(session.getId()))));
        sessionRepository.deleteAll(sessions);
        betRepository.deleteAll(bets);
        challenges.forEach(challenge -> challengeDurationRepository.findById(challenge.getId())
                .ifPresent(challengeDurationRepository::delete));
        challengeRepository.deleteAll(challenges);
        if (group != null) {
            groupRepository.delete(group);
        }
        deleteVersions(user.getId());
        extraUsers.forEach(extra -> deleteVersions(extra.getId()));
        userRepository.deleteAll(extraUsers);
        userRepository.delete(user);
        sessions.clear();
        bets.clear();
        challenges.clear();
        extraUsers.clear();
        group = null;
    }

    private void deleteVersions(UUID userId) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery("DELETE FROM aggregate_versions"
                                + " WHERE aggregate_type = :type AND aggregate_id = :id")
                        .setParameter("type", AggregateRef.TYPE_USER)
                        .setParameter("id", userId.toString())
                        .executeUpdate());
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
    void lenientCliDoesNotPublishAManifestThatOmitsAnUnreconstructableRow(@TempDir Path directory) throws Exception {
        insertLog("UNRECONSTRUCTABLE_LEGACY_KIND", "PENDING", null);
        var runner = new NotificationMigrationCliRunner(exportService, null);
        runner.run(new DefaultApplicationArguments(
                "--notification.migration.id=" + MIGRATION_ID,
                "--notification.migration.export-to=" + directory.resolve("export.json"),
                "--notification.migration.lenient=true",
                "--notification.migration.closed-at=" + SLOT.toEpochMilli(),
                "--notification.migration.inflight-drained=true"));

        var diagnostic = new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(Files.readString(directory.resolve("export.json")));
        assertThat(diagnostic.get("report").get("finalEligible").asBoolean()).isFalse();
        assertThat(diagnostic.get("failures").toString()).contains("UNRECONSTRUCTABLE_LEGACY_KIND");
        assertThat(directory.resolve("export.verify.json")).doesNotExist();
        assertThat(directory.resolve("export.import-0000.json")).doesNotExist();
    }

    @Test
    void duplicateDeviceKeysCannotBeMarkedAsFinalEligible() {
        String token = "duplicate-export-token-" + UUID.randomUUID();
        User first = addTokenUser(token, false, false);
        User second = addTokenUser(token, false, true);

        NotificationExportDocument document = exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, false);

        assertThat(document.report().duplicateDeviceTokens()).anySatisfy(duplicate -> {
            assertThat(duplicate.userIds()).containsExactlyInAnyOrder(
                    first.getId().toString(), second.getId().toString());
            assertThat(duplicate.deviceTokenPrefix()).isEqualTo("duplicat…");
        });
        assertThat(document.report().finalEligible()).isFalse();
        assertThat(document.records().stream().filter(record ->
                NotificationMigrationRecord.RESOURCE_DEVICE.equals(record.resource()))
                .filter(record -> token.equals(record.data().get("deviceToken"))))
                .as("진단 export에서 중복 원문을 조용히 한 계정으로 접지 않는다").hasSize(2);
    }

    @Test
    void strictExportRejectsDuplicateDeviceOwnership() {
        String token = "duplicate-export-token-" + UUID.randomUUID();
        addTokenUser(token, false, false);
        addTokenUser(token, false, false);

        assertThatThrownBy(() -> exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, true))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("중복 기기 토큰");
    }

    @Test
    void onlyExportedDevicesParticipateInDuplicateDetection() {
        String token = "bot-shared-token-" + UUID.randomUUID();
        User owner = addTokenUser(token, false, false);
        addTokenUser(token, true, false);
        addTokenUser(token, true, false);

        NotificationExportDocument document = exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, true);

        assertThat(document.report().duplicateDeviceTokens()).noneSatisfy(duplicate ->
                assertThat(duplicate.userIds()).contains(owner.getId().toString()));
        assertThat(document.report().finalEligible()).isTrue();
        assertThat(document.records().stream().filter(record -> token.equals(record.data().get("deviceToken"))))
                .hasSize(1);
    }

    @Test
    void blankLegacyTokensAreAbsentWhileNonblankTokenBytesArePreserved() {
        User blank = addTokenUser(" \t\n", false, false);
        User anotherBlank = addTokenUser(" \t\n", false, false);
        String original = " unmodified-token-" + UUID.randomUUID() + " ";
        User valid = addTokenUser(original, false, false);

        NotificationExportDocument document = exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, true);

        assertThat(document.records().stream().filter(record ->
                NotificationMigrationRecord.RESOURCE_DEVICE.equals(record.resource())))
                .noneSatisfy(record -> assertThat(record.data().get("userId"))
                        .isIn(blank.getId().toString(), anotherBlank.getId().toString()))
                .anySatisfy(record -> assertThat(record.data()).containsEntry("userId", valid.getId().toString())
                        .containsEntry("deviceToken", original));
        assertThat(document.report().finalEligible()).isTrue();
    }

    @ParameterizedTest
    @EnumSource(value = NotificationKind.class, names = {"FRIEND_REQUEST", "FRIEND_ACCEPTED", "CHALLENGE_CREATED",
            "CHALLENGE_WINDOW_END", "CHALLENGE_ENDED"})
    void legacySentRowsRecoverTheirKindSpecificSubject(NotificationKind kind) {
        UUID target = UUID.randomUUID();
        insertLegacyLog(kind, null, target);

        NotificationExportDocument document = exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, true);

        assertThat(deliveriesOf(document)).singleElement().satisfies(record -> {
            assertThat(record.recordKey()).isEqualTo(NotificationEventKey.of(kind, user.getId(), target, SLOT));
            assertThat(record.data()).containsEntry("subjectId", target.toString()).containsEntry("status", "SENT");
        });
        assertThat(document.report().finalEligible()).isTrue();
        Object[] original = (Object[]) entityManager.createNativeQuery(
                        "SELECT subject_id,target_user_id FROM notification_sent_logs WHERE user_id=:userId")
                .setParameter("userId", user.getId()).getSingleResult();
        assertThat(original[0]).as("export는 V45의 의도적인 null을 코어에서 수정하지 않는다").isNull();
        assertThat(original[1].toString()).isEqualTo(target.toString());
    }

    @ParameterizedTest
    @EnumSource(value = NotificationKind.class, names = {"FRIEND_REQUEST", "FRIEND_ACCEPTED", "CHALLENGE_CREATED",
            "CHALLENGE_WINDOW_END", "CHALLENGE_ENDED"})
    void explicitSubjectAlwaysWinsOverTheLegacyTarget(NotificationKind kind) {
        UUID explicit = UUID.randomUUID();
        insertLegacyLog(kind, explicit, UUID.randomUUID());

        NotificationExportDocument document = exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, true);

        assertThat(deliveriesOf(document)).singleElement().satisfies(record ->
                assertThat(record.recordKey()).isEqualTo(NotificationEventKey.of(kind, user.getId(), explicit, SLOT)));
    }

    @Test
    void anUnrelatedKindsTargetCannotBeInventedAsASubject() {
        insertLegacyLog(NotificationKind.BET_WON, null, UUID.randomUUID());
        NotificationExportDocument document = exportService.export(MIGRATION_ID, SLOT.toEpochMilli(), true, false);
        assertThat(document.failures()).anySatisfy(failure ->
                assertThat(failure.reason()).isEqualTo(NotificationExportService.FAIL_NO_SUBJECT));
        assertThat(document.report().finalEligible()).isFalse();
    }

    private User addTokenUser(String token, boolean bot, boolean withdrawn) {
        User extra = userRepository.save(User.builder().nickname("export-token-" + UUID.randomUUID()).build());
        extraUsers.add(extra);
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery("UPDATE users SET device_token=:token,is_bot=:bot,is_deleted=:withdrawn"
                                + " WHERE id=:id")
                        .setParameter("token", token).setParameter("bot", bot).setParameter("withdrawn", withdrawn)
                        .setParameter("id", extra.getId()).executeUpdate());
        return extra;
    }

    private void insertLegacyLog(NotificationKind kind, UUID subject, UUID target) {
        insertLog(kind.name(), "SENT", SLOT);
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery("UPDATE notification_sent_logs SET subject_id=:subject,"
                                + "target_user_id=:target,slot_at=NULL,claimed_at=NULL WHERE user_id=:userId AND kind=:kind")
                        .setParameter("subject", subject).setParameter("target", target)
                        .setParameter("userId", user.getId()).setParameter("kind", kind.name()).executeUpdate());
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
    @DisplayName("이관 재시도와 선점 갱신은 원 슬롯의 만료를 연장하지 않는다")
    void exportPreservesOriginalExpiryAcrossLaterClaims() {
        insertLog(NotificationKind.STREAK_AT_RISK.name(), "PENDING", null);
        NotificationMigrationRecord before = deliveriesOf(
                exportService.export(MIGRATION_ID, null, false, true)).get(0);
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery("UPDATE notification_sent_logs SET claimed_at=:later WHERE user_id=:user")
                        .setParameter("later", SLOT.plusSeconds(86400))
                        .setParameter("user", user.getId()).executeUpdate());
        NotificationMigrationRecord after = deliveriesOf(
                exportService.export(MIGRATION_ID, null, false, true)).get(0);
        assertThat((Map<?, ?>) before.data().get("params")).isEqualTo(after.data().get("params"));
        Map<?, ?> params = (Map<?, ?>) after.data().get("params");
        assertThat(params.get("dedupAt")).isEqualTo(SLOT.toString());
        assertThat(params.get("expiresAt")).isEqualTo("2026-09-11T14:00:00Z");
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
    @DisplayName("manifest 는 자원 다섯을 모두 갖고, 빈 자원도 체크섬을 갖는다")
    void manifestAlwaysCarriesAllFiveResources() {
        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        Map<String, NotificationMigrationManifest.ResourceDigest> resources =
                document.manifest().resources();
        assertThat(resources).containsOnlyKeys(
                NotificationMigrationRecord.RESOURCE_SETTINGS,
                NotificationMigrationRecord.RESOURCE_DEVICE,
                NotificationMigrationRecord.RESOURCE_DELIVERY,
                NotificationMigrationRecord.RESOURCE_USER,
                NotificationMigrationRecord.RESOURCE_PARTICIPATION);
        // counts 도 같은 다섯 축을 싣는다 — 사람이 읽는 쪽에서 자원 하나가 조용히 빠지지 않게.
        assertThat(document.report().counts()).containsKeys("settings", "device", "delivery",
                "user", "participation");
        // 「행이 없다」와 「자원을 통째로 빠뜨렸다」가 구분돼야 한다.
        resources.values().forEach(digest -> assertThat(digest.checksum()).hasSize(64));
        assertThat(document.manifest().version()).isEqualTo(NotificationMigrationManifest.VERSION);
        assertThat(document.manifest().stopWindow().source())
                .isEqualTo(NotificationMigrationManifest.StopWindow.SOURCE);
        NotificationExportDocument next = exportService.export(MIGRATION_ID, null, false, true);
        assertThat(UUID.fromString(document.manifest().snapshot())).isNotNull();
        assertThat(next.manifest().snapshot()).isNotEqualTo(document.manifest().snapshot());
        // 같은 커서·내용이어도 별도 export는 다른 전체 집합이다. 청크는 이 문서의 식별자를 재사용한다.
        assertThat(next.manifest().stopWindow().cursor()).isEqualTo(document.manifest().stopWindow().cursor());
        assertThat(next.manifest().resources()).isEqualTo(resources);
    }

    // ── 투영 bootstrap (승인 계획 ②′) ──────────────────────────────────

    @Test
    @DisplayName("유저 투영 bootstrap 은 표시명·언어를 싣고, 설정 행이 없으면 5필드를 전부 null 로 둔다")
    void userBootstrapCarriesDisplayNameAndLeavesAbsentSettingsNull() {
        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        assertThat(userRecordOf(document)).isNotNull().satisfies(record -> {
            assertThat(record.recordKey()).isEqualTo(user.getId().toString());
            assertThat(record.data())
                    .containsEntry("displayName", user.getNickname())
                    .containsEntry("locale", "ko")
                    // 설정 행은 지연 생성이다 — 기본값을 여기서 채우면 「사용자가 직접 켠 것」과
                    // 구분되지 않고, 나중에 기본값이 바뀌어도 옛 값이 박제된다.
                    .containsEntry("settingsPresent", false)
                    .containsEntry("notificationEnabled", null)
                    .containsEntry("soundEnabled", null)
                    .containsEntry("nightModeEnabled", null)
                    .containsEntry("nightStartTime", null)
                    .containsEntry("nightEndTime", null);
        });
    }

    @Test
    @DisplayName("탈퇴자는 유저 투영에 싣지 않는다 — 수신 측이 어차피 tombstone 으로 건너뛰므로 PII 만 남는다")
    void withdrawnUsersAreNotProjected() {
        User withdrawn = userRepository.save(User.builder()
                .nickname("탈퇴-" + UUID.randomUUID().toString().substring(0, 8))
                .language("ko")
                .build());
        extraUsers.add(withdrawn);
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery("UPDATE users SET is_deleted = true WHERE id = :id")
                        .setParameter("id", withdrawn.getId())
                        .executeUpdate());

        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        assertThat(recordsOf(document, NotificationMigrationRecord.RESOURCE_USER)).noneSatisfy(record ->
                assertThat(record.data()).containsEntry("userId", withdrawn.getId().toString()));
    }

    @Test
    @DisplayName("참가 투영은 회차마다 별도 키다 — 유저로 접으면 한 회차가 다른 회차를 덮어 그 회차 참가자가 사라진다")
    void participationBootstrapKeysEverySessionSeparately() {
        GroupChallengeBetSession first = openSession();
        GroupChallengeBetSession second = openSession();
        participantRepository.save(GroupChallengeBetParticipant.builder()
                .session(first).user(user).build());
        participantRepository.save(GroupChallengeBetParticipant.builder()
                .session(second).user(user).build());

        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        List<NotificationMigrationRecord> records = participationsOf(document);
        assertThat(records).hasSize(2);
        assertThat(records).extracting(NotificationMigrationRecord::recordKey)
                .containsExactlyInAnyOrder(user.getId() + ":" + first.getId(),
                        user.getId() + ":" + second.getId());
        assertThat(records.get(0).data())
                .containsEntry("groupId", group.getId().toString())
                .containsEntry("sessionStatus", GroupBetStatus.OPEN.name())
                .containsEntry("stake", (long) STAKE)
                // 정산 전에는 판정이 «없다» — false 로 접으면 상태가 하나 사라진다.
                .containsEntry("achieved", null);
    }

    @Test
    @DisplayName("정산이 끝난 회차의 참가는 투영 밖이다 — 그쪽은 미발송 delivery 가 이미 옮긴다")
    void settledSessionsAreOutOfProjectionScope() {
        GroupChallengeBetSession settled = openSession();
        participantRepository.save(GroupChallengeBetParticipant.builder()
                .session(settled).user(user).build());
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery("UPDATE group_challenge_bet_sessions"
                                + " SET status = 'SETTLED', settled_at = now() WHERE id = :id")
                        .setParameter("id", settled.getId())
                        .executeUpdate());

        assertThat(participationsOf(exportService.export(MIGRATION_ID, null, false, true))).isEmpty();
    }

    /**
     * bootstrap 의 {@code version} 이 0 이면, 스냅샷 이전에 발행돼 백로그에 남아 있던 사건(version ≥ 1)이
     * 전부 「더 새것」으로 통과해 <b>최신 스냅샷 위에 옛 상태를 덮는다</b>. 그래서 유저 축의 현재
     * version 을 그대로 스탬프한다 — 그러면 이전 사건은 정확히 거부되고 이후 사건만 적용된다.
     */
    @Test
    @DisplayName("두 투영 모두 «지금 유저 축 version» 으로 스탬프된다 — 0 을 박으면 백로그가 스냅샷을 덮는다")
    void bothProjectionsAreStampedWithTheCurrentUserAxisVersion() {
        GroupChallengeBetSession session = openSession();
        participantRepository.save(GroupChallengeBetParticipant.builder()
                .session(session).user(user).build());
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                entityManager.createNativeQuery("INSERT INTO aggregate_versions"
                                + "(aggregate_type, aggregate_id, last_version, updated_at)"
                                + " VALUES (:type, :id, 7, now())")
                        .setParameter("type", AggregateRef.TYPE_USER)
                        .setParameter("id", user.getId().toString())
                        .executeUpdate());

        NotificationExportDocument document = exportService.export(MIGRATION_ID, null, false, true);

        assertThat(userRecordOf(document).data()).containsEntry("version", 7L);
        assertThat(participationsOf(document)).singleElement()
                .satisfies(record -> assertThat(record.data()).containsEntry("version", 7L));
        // 설정 자원도 같은 축·같은 값이다 — 둘이 갈리면 한쪽만 옛 사건을 받아들인다.
        assertThat(recordsOf(document, NotificationMigrationRecord.RESOURCE_SETTINGS))
                .allSatisfy(record -> assertThat(record.data()).containsKey("version"));
    }

    // ── 투영 픽스처 ────────────────────────────────────────────────────

    /** 진행 중·미정산 회차 하나. 참가 투영이 읽는 조건({@code status='OPEN'})을 그대로 만든다. */
    private GroupChallengeBetSession openSession() {
        if (group == null) {
            group = groupRepository.save(Group.builder().name("이관검증").build());
        }
        GroupChallenge challenge;
        GroupChallengeBet bet;
        if (challenges.isEmpty()) {
            challenge = challengeRepository.save(GroupChallenge.builder()
                    .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
            challenges.add(challenge);
            challengeDurationRepository.save(GroupChallengeDuration.builder()
                    .challenge(challenge).category(MissionCategory.FOCUS)
                    .durationMinutes(GOAL_MINUTES).build());
            bet = betRepository.save(GroupChallengeBet.builder()
                    .group(group).challenge(challenge).stake(STAKE).enabled(true).build());
            bets.add(bet);
        } else {
            challenge = challenges.get(0);
            bet = bets.get(0);
        }
        GroupChallengeBetSession session = sessionRepository.save(GroupChallengeBetSession.builder()
                .bet(bet).group(group).challenge(challenge)
                .sessionDate(LocalDate.now().plusDays(sessions.size()))
                .stake(STAKE).goalMinutes(GOAL_MINUTES)
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .status(GroupBetStatus.OPEN)
                .startsAt(SLOT).joinClosesAt(SLOT).closesAt(SLOT).settleAfter(SLOT)
                .build());
        sessions.add(session);
        return session;
    }

    private List<NotificationMigrationRecord> recordsOf(NotificationExportDocument document,
            String resource) {
        return document.records().stream()
                .filter(record -> resource.equals(record.resource()))
                .toList();
    }

    private NotificationMigrationRecord userRecordOf(NotificationExportDocument document) {
        return recordsOf(document, NotificationMigrationRecord.RESOURCE_USER).stream()
                .filter(record -> user.getId().toString().equals(record.data().get("userId")))
                .findFirst().orElse(null);
    }

    private List<NotificationMigrationRecord> participationsOf(NotificationExportDocument document) {
        return recordsOf(document, NotificationMigrationRecord.RESOURCE_PARTICIPATION).stream()
                .filter(record -> user.getId().toString().equals(record.data().get("userId")))
                .toList();
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
