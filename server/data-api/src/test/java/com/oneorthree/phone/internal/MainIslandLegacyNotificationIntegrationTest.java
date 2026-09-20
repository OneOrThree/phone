package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.event.MainIslandTransferredEvent;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.InternalAccountService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.notification.service.MainIslandNotificationService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.service.UserService;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * 메인 섬 자동 이전 알림이 <b>구 경로({@code mode=LEGACY})에서도 실제로 나가는지</b> (GROMO-1971).
 *
 * <h2>왜 클래스를 나눴는가</h2>
 * {@code notification.dispatch.mode} 는 컨텍스트 속성이라 한 클래스 안에서 두 모드를 태울 수 없다.
 * {@code MainIslandIntegrationTest} 가 {@code OUTBOX} 를 강제하는 동안 <b>구 경로는 한 번도 실행되지
 * 않았고</b>, 그래서 「초록인데 dev·prod 에서는 발송이 0」인 구멍이 보이지 않았다. 같은 이전 사건이
 * 두 모드에서 <b>각자의 방식으로</b> 나가는 것을 양쪽에서 고정한다.
 *
 * <h2>발송을 무엇으로 확인하는가</h2>
 * {@code ci} 프로파일의 {@code NoOpPushNotification} 은 {@code PushSendResult.SENT} 를 돌려주므로
 * 발송 경로가 끝까지 돌고, 그 결과가 {@code notification_sent_logs} 행으로 남는다
 * ({@code NotificationDispatchOutcome.recordsLegacyLog()}). 그 행이 「구 경로가 실제로 보냈다」의 증거다.
 *
 * <h2>시각 의존을 제거한다</h2>
 * 조용한 시간 기본값이 KST 23:00–07:00 이라 아무 설정 없이 단언하면 <b>밤에 도는 CI 에서만 빨개진다</b>.
 * 그래서 생산 설정 경로로 {@code nightMode} 를 퇴화 구간(start == end)으로 박아 「항상 발송 허용」을
 * 고정한다 — 테스트가 시계를 보지 않게 만드는 것이지, 필터를 우회하는 것이 아니다.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MainIslandLegacyNotificationIntegrationTest {

    private static final String KIND = "MAIN_ISLAND_TRANSFERRED";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("island-management.commands-enabled", () -> true);
        // 이 클래스의 전부다 — 구 경로에서 실제로 나가는지를 본다.
        registry.add("notification.dispatch.mode", () -> "LEGACY");
    }

    @Autowired IslandMembershipService islands;
    @Autowired IslandJoinService joins;
    @Autowired IslandManagementService management;
    @Autowired InternalAccountService account;
    @Autowired UserService users;
    @Autowired MainIslandNotificationService notifications;
    @Autowired AccountWithdrawalService withdrawal;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired JdbcTemplate jdbc;

    @Test
    @DisplayName("구 경로에서 메인 섬 이전 푸시가 실제로 나가고 sent_log 에 남는다 — 신 경로 봉투는 적히지 않는다")
    void legacyModeActuallySendsAndRecordsTheSentLog() {
        Actor actor = reachableUser(true);
        UUID user = actor.id();
        UUID first = island(user, "레거시첫섬");
        UUID latest = joined(user, island(reachableUser(true).id(), "레거시나중섬"));

        management.leave(user, first, UUID.randomUUID());

        // 구 경로는 AFTER_COMMIT + @Async 라 커밋 뒤에 돈다.
        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(sentLogs(user)).isEqualTo(1));
        assertThat(mainIslandOf(actor)).isEqualTo(latest);
        // LEGACY 모드에서는 BEFORE_COMMIT 리스너가 빠지므로 outbox 봉투가 없어야 한다 —
        // 둘이 함께 돌면 같은 알림이 FCM 으로도 가고 Kafka 로도 간다.
        assertThat(outboxNotices(user)).isZero();
        assertThat(sentLogRow(user)).containsEntry("kind", KIND);
    }

    @Test
    @DisplayName("알림을 끈 사용자에게는 보내지도 기록하지도 않지만 메인 섬 이전은 그대로 일어난다")
    void notificationOffSkipsSendAndLogButStillMovesTheMainIsland() {
        Actor actor = reachableUser(false);
        UUID user = actor.id();
        UUID first = island(user, "알림끈첫섬");
        UUID latest = joined(user, island(reachableUser(true).id(), "알림끈나중섬"));

        management.leave(user, first, UUID.randomUUID());

        // 이전은 도메인 트랜잭션의 일이라 알림 설정과 무관하다.
        assertThat(mainIslandOf(actor)).isEqualTo(latest);
        // 발송 스킵은 recordsLegacyLog() 가 false 라는 뜻이다 — 조용한 시간·토큰 없음과 같은 취급이다.
        // 비동기라 «아직 안 온 것»과 «오지 않을 것»을 구분해야 해서 일정 시간 0 이 유지되는지를 본다.
        await().during(Duration.ofSeconds(2)).atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(sentLogs(user)).isZero());
        assertThat(outboxNotices(user)).isZero();
    }

    @Test
    @DisplayName("1분 안에 연속으로 두 번 옮겨지면 구 경로도 «두 건» 보낸다 — 모드에 따라 알림 수가 달라지면 안 된다")
    void backToBackTransfersSendTwiceInLegacyModeToo() {
        Actor actor = reachableUser(true);
        UUID user = actor.id();
        UUID first = island(user, "구경로첫섬");
        UUID middle = joined(user, island(reachableUser(true).id(), "구경로중간섬"));
        UUID latest = joined(user, island(reachableUser(true).id(), "구경로나중섬"));

        management.leave(user, first, UUID.randomUUID());
        management.leave(user, latest, UUID.randomUUID());
        assertThat(mainIslandOf(actor)).isEqualTo(middle);

        // 신 경로(OUTBOX)는 커밋 직전에 둘 다 적는다. 구 경로가 「최종 상태와 다르다」로 첫 건을 버리면
        // 같은 사건이 모드에 따라 1건·2건이 된다 — 그 불일치를 여기서 고정한다.
        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(sentLogs(user)).isEqualTo(2));
        assertThat(sentTargets(user)).containsExactly(latest.toString(), middle.toString());
    }

    @Test
    @DisplayName("이미 지나간 이전도 그대로 알린다 — 「지금의 메인 섬이 아니다」로 버리면 모드마다 알림 수가 갈린다")
    void aTransferThatIsNoLongerCurrentStillNotifies() {
        Actor actor = reachableUser(true);
        UUID user = actor.id();
        UUID first = joined(user, island(reachableUser(true).id(), "지난첫섬"));
        UUID middle = joined(user, island(reachableUser(true).id(), "지난중간섬"));
        UUID latest = joined(user, island(reachableUser(true).id(), "지난나중섬"));
        management.leave(user, first, UUID.randomUUID());
        management.leave(user, latest, UUID.randomUUID());
        assertThat(mainIslandOf(actor)).isEqualTo(middle);
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> assertThat(sentLogs(user)).isEqualTo(2));

        // 첫 이전(→ 나중섬)의 사건을 «최종 상태가 중간섬으로 굳은 뒤» 그대로 처리한다. 구 경로는
        // AFTER_COMMIT + @Async 라 실제로 이 순서가 난다 — 비동기 스케줄링에 기대지 않고 그 순서를 직접 만든다.
        // 여기서 버리면 같은 사건이 신 경로(BEFORE_COMMIT, 2건)와 구 경로(1건)로 갈린다.
        notifications.notifyTransferred(new MainIslandTransferredEvent(user, latest, "지난나중섬", Instant.now()));

        assertThat(sentLogs(user)).isEqualTo(3);
        assertThat(sentTargets(user))
                .containsExactly(latest.toString(), middle.toString(), latest.toString());
    }

    @Test
    @DisplayName("같은 섬으로 두 번 옮겨져도 발송 기록이 실패하지 않는다 — 섬은 유니크 축(subject_id)이 아니다")
    void movingBackToTheSameIslandRecordsBothSends() {
        Actor actor = reachableUser(true);
        UUID user = actor.id();
        // 둘 다 «남의 섬»이어야 한다 — 방장으로 만들면 마지막 1인 이탈이 섬을 닫아 재가입할 곳이 없다.
        UUID first = joined(user, island(reachableUser(true).id(), "왕복첫섬"));
        UUID other = joined(user, island(reachableUser(true).id(), "왕복상대섬"));

        management.leave(user, first, UUID.randomUUID());      // → other (1회차)
        joined(user, first);                                    // 재가입
        management.leave(user, other, UUID.randomUUID());       // → first
        joined(user, other);                                    // 재가입
        management.leave(user, first, UUID.randomUUID());       // → other (2회차, 같은 섬)

        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(sentLogs(user)).isEqualTo(3));
        // 섬을 subject_id 에 넣으면 (user, kind, subject) 유니크가 2회차를 막아 «기록»이 실패하고
        // 비동기 예외가 삼켜져 알림이 조용히 사라진다. 같은 섬 2건이 남는 것이 그 회귀의 증인이다.
        assertThat(sentTargets(user)).containsExactly(other.toString(), first.toString(), other.toString());
    }

    @Test
    @DisplayName("계정 탈퇴 도중의 중간 이전은 탈퇴자에게 가지 않는다 — 활성 검사 하나로 막는다")
    void withdrawalNeverNotifiesTheWithdrawnUser() {
        Actor actor = reachableUser(true);
        UUID user = actor.id();
        joined(user, island(reachableUser(true).id(), "탈퇴첫섬"));
        joined(user, island(reachableUser(true).id(), "탈퇴나중섬"));

        withdrawal.withdraw(user);

        // 탈퇴는 멤버십을 여러 번 끝내므로 중간 이전 사건이 생길 수 있다 — 그래도 수신자가 이미 파기돼
        // 발송도 기록도 없어야 한다. 「아직 안 온 것」과 「오지 않을 것」을 구분해 일정 시간 0 을 본다.
        await().during(Duration.ofSeconds(2)).atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(sentLogs(user)).isZero());
    }

    // ---------------------------------------------------------------- 도구

    /**
     * 푸시가 닿을 수 있는 사용자 — 기기 토큰이 있고 조용한 시간이 퇴화 구간이다.
     *
     * @param notificationEnabled 알림 수신 on/off
     */
    private Actor reachableUser(boolean notificationEnabled) {
        var login = auth.guestLogin();
        UUID userId = jwt.extractUserId(login.accessToken());
        users.registerDeviceToken(userId, "test-device-token-" + userId);
        NotificationSettingsRequest settings = new NotificationSettingsRequest();
        ReflectionTestUtils.setField(settings, "notificationEnabled", notificationEnabled);
        ReflectionTestUtils.setField(settings, "soundEnabled", true);
        // start == end 는 «빈 구간» 이라 PushNotificationService 가 항상 발송을 허용한다.
        ReflectionTestUtils.setField(settings, "nightModeEnabled", true);
        ReflectionTestUtils.setField(settings, "nightStartTime", "00:00");
        ReflectionTestUtils.setField(settings, "nightEndTime", "00:00");
        users.updateNotificationSettings(userId, settings);
        return new Actor(userId, login.sessionId());
    }

    private record Actor(UUID id, UUID session) {
    }

    private UUID island(UUID owner, String name) {
        return islands.create(owner, new CreateIslandCommandRequest(name, null, false),
                UUID.randomUUID()).id();
    }

    private UUID joined(UUID userId, UUID islandId) {
        joins.join(userId, islandId, null, UUID.randomUUID());
        return islandId;
    }

    private UUID mainIslandOf(Actor actor) {
        return account.me(actor.id(), actor.session(), 0L).mainIslandId();
    }

    /** 발송 기록에 남은 «옮겨 간 섬» 들 — 이관이 복원할 대상 축이 target_user_id 에 실렸는지도 함께 본다. */
    private java.util.List<String> sentTargets(UUID userId) {
        return jdbc.queryForList("select target_user_id from notification_sent_logs"
                + " where user_id=? and type=? order by sent_at, id", String.class, userId, KIND);
    }

    private long sentLogs(UUID userId) {
        return jdbc.queryForObject(
                "select count(*) from notification_sent_logs where user_id=? and type=? and sent_at is not null",
                Long.class, userId, KIND);
    }

    private java.util.Map<String, Object> sentLogRow(UUID userId) {
        return jdbc.queryForMap("select * from notification_sent_logs where user_id=? and type=?", userId, KIND);
    }

    private long outboxNotices(UUID userId) {
        return jdbc.queryForObject("select count(*) from event_outbox"
                + " where user_id=? and type='notification.requested' and params->>'kind'=?",
                Long.class, userId, KIND);
    }
}
