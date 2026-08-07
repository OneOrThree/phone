package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * 친구 요청·수락 푸시의 <b>커밋 게이트</b> 통합 테스트 (GROMO-1090) — 실 DB + ci 프로파일의 NoOp 포트.
 *
 * <p>여기서만 확인할 수 있는 성질이 하나 있다: <b>롤백된 친구 요청에는 알림이 나가지 않는다</b>.
 * 목 기반 단위 테스트는 리스너를 직접 호출하므로 이 성질을 증명할 수 없다 — 실제 트랜잭션이
 * 커밋/롤백돼야 {@code AFTER_COMMIT} 이 판정된다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는다. 테스트가 트랜잭션을 열면 그 안의 커밋이 영영 일어나지
 * 않아 리스너 자체가 뜨지 않는다. 데이터는 {@code @AfterEach} 에서 직접 지운다.
 *
 * <p>수신자 알림 설정의 심야 구간을 <b>00:00~00:00(빈 구간)</b> 으로 둔다. 발송 판정은 실제 현재 시각을
 * 쓰므로, 기본 심야(23–07 KST)에 CI 가 돌면 quiet hours 로 스킵돼 결과가 시간대에 따라 달라진다.
 */
class FriendPushNotificationIntegrationTest extends IntegrationTestBase {

    @Autowired
    FriendService friendService;
    @Autowired
    FriendshipRepository friendshipRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    NotificationSentLogRepository notificationSentLogRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    private final List<User> users = new ArrayList<>();

    private User sender;
    private User receiver;

    @BeforeEach
    void setUp() {
        sender = pushableUser("보낸사람");
        receiver = pushableUser("받는사람");
    }

    @AfterEach
    void tearDown() {
        users.forEach(user -> friendshipRepository.deleteAll(
                friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(user, FriendshipStatus.PENDING)));
        users.forEach(user -> friendshipRepository.deleteAll(friendshipRepository.findAcceptedByUser(user)));
        users.forEach(user -> friendshipRepository.deleteAll(
                friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(user, FriendshipStatus.REJECTED)));
        notificationSentLogRepository.deleteAll(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST));
        notificationSentLogRepository.deleteAll(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED));
        users.forEach(user -> userNotificationSettingsRepository.findById(user.getId())
                .ifPresent(userNotificationSettingsRepository::delete));
        userRepository.deleteAll(users);
        users.clear();
    }

    // ── 대기 전략 (GROMO-1228, codex 2라운드) ─────────────────────────────
    // executor 카운터는 어떤 조합으로도 결정적 드레인이 안 된다 — getTaskCount() 는 문서화된
    // 근사치라 워커가 큐에서 작업을 꺼낸 직후(락 획득 전) 창에서 실행 중 작업이 계수되지 않고,
    // 그 창은 "제출 직후"든 "DB 가시 이후"든 어느 읽기 시점에나 걸릴 수 있다. 그래서 카운터를
    // 전면 폐기하고 DB 사후조건만 본다. 정확 개수·부정 단정은 during(유지) 대기로 잠근다:
    // 제출은 커밋 스레드에서 **동기**로 일어나므로(afterCommit 리스너의 execute 호출) 회귀로
    // 늘어난 중복 제출도 폴링 시작 전에 끝나 있고, 작업 본체는 NoOp 포트 + 짧은 트랜잭션이라
    // ms 단위다 — "기대 개수가 500ms 유지"는 지연 도착 중복을 시간 유계로 잡는다.
    private static final Duration HOLD = Duration.ofMillis(500);
    private static final Duration DEADLINE = Duration.ofSeconds(5);

    @Test
    @DisplayName("친구 요청이 커밋되면 받은 쪽에 발송 기록이 남는다")
    void createRequest_committed_sendsToReceiver() {
        friendService.createRequest(sender.getId(), receiver.getId());

        // 발송은 별도 스레드라 DB 사후조건을 직접 기다린다. singleElement 가 HOLD 동안 유지돼야
        // 통과 — 한 커밋이 발송을 두 번 제출하는 회귀가 첫 행만 보고 지나가지 못하게(codex 리뷰).
        await().during(HOLD).atMost(DEADLINE).untilAsserted(() ->
                assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).singleElement()
                        .satisfies(sentLog -> {
                            assertThat(sentLog.getUserId()).isEqualTo(receiver.getId());
                            assertThat(sentLog.getTargetUserId()).isEqualTo(sender.getId());
                        }));
    }

    @Test
    @DisplayName("친구 요청이 롤백되면 알림이 나가지 않는다 — 요청도 알림도 없다")
    void createRequest_rolledBack_sendsNothing() {
        // 요청 자체가 없던 일이 됐는데 알림만 나가면, 받은 쪽은 목록에 없는 요청의 푸시를 받는다.
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            friendService.createRequest(sender.getId(), receiver.getId());
            status.setRollbackOnly();
        });

        assertThat(friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(
                sender, FriendshipStatus.PENDING)).isEmpty();
        // 롤백이면 제출 자체가 없어야 한다 — "비어 있음"이 HOLD 동안 유지돼야 통과(회귀로 뒤늦게
        // 나가는 발송을 시간 유계로 탐지).
        await().during(HOLD).atMost(DEADLINE).untilAsserted(() ->
                assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).isEmpty());
    }

    @Test
    @DisplayName("수락이 커밋되면 요청을 보냈던 쪽에 발송 기록이 남는다")
    void acceptRequest_committed_sendsToRequester() {
        friendService.createRequest(sender.getId(), receiver.getId());
        awaitFriendRequestPushLogged();

        friendService.acceptRequest(receiver.getId(), pendingRequestId());

        // singleElement + HOLD 유지 — createRequest_committed_sendsToReceiver 와 같은 이유.
        await().during(HOLD).atMost(DEADLINE).untilAsserted(() ->
                assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).singleElement()
                        .satisfies(sentLog -> {
                            assertThat(sentLog.getUserId()).isEqualTo(sender.getId());
                            assertThat(sentLog.getTargetUserId()).isEqualTo(receiver.getId());
                        }));
    }

    @Test
    @DisplayName("같은 수락이 두 번 들어와도 발송은 한 번뿐이다 — 두 번째는 상태 전이가 아니다")
    void acceptRequest_twice_sendsOnce() {
        // acceptRequest 는 현재 상태를 검사하지 않고 ACCEPTED 를 덮어쓴다. 이벤트 발행을 실제 상태
        // 전이로 제한하지 않으면 클라 재시도·연타가 그대로 두 번째 푸시가 된다(@codex 리뷰).
        friendService.createRequest(sender.getId(), receiver.getId());
        awaitFriendRequestPushLogged();
        UUID requestId = pendingRequestId();

        friendService.acceptRequest(receiver.getId(), requestId);
        friendService.acceptRequest(receiver.getId(), requestId);

        // "정확히 1건이 HOLD 동안 유지"를 요구한다 — 순간 스냅샷 hasSize(1) 은 첫 발송만 남은
        // 중간 상태에서 통과해 지연 도착하는 두 번째 발송(회귀)을 놓친다(codex 리뷰). 회귀의
        // 중복 제출은 두 번째 accept 커밋에서 동기로 끝나 있으므로, 실행 지연만 HOLD 가 덮으면
        // 된다. 2건이 되면 조건이 깨져 DEADLINE 에서 실패한다.
        await().during(HOLD).atMost(DEADLINE)
                .until(() -> sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED).size() == 1);
    }

    @Test
    @DisplayName("거절은 어느 쪽에도 알리지 않는다")
    void rejectRequest_sendsNothing() {
        // 요청 푸시가 먼저 남을 때까지 기다린다 — 발송이 비동기라, 거절이 먼저 커밋되면 요청 푸시가
        // "이미 처리된 요청" 으로 생략될 수 있다(그 자체는 정상 동작이지만 아래 단정이 흔들린다).
        friendService.createRequest(sender.getId(), receiver.getId());
        awaitFriendRequestPushLogged();

        friendService.rejectRequest(receiver.getId(), pendingRequestId());

        // "ACCEPTED 0건 ∧ REQUEST 1건(요청 시점 그대로)"이 HOLD 동안 유지 — 거절이 뭔가를
        // 제출하는 회귀는 커밋에서 동기 제출이 끝나 있어, 실행 지연만 HOLD 가 덮으면 잡힌다.
        await().during(HOLD).atMost(DEADLINE).untilAsserted(() -> {
            assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).isEmpty();
            assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).hasSize(1);
        });
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    /** 토큰이 있고 심야 구간이 비어 있어(00:00~00:00) 언제 실행해도 발송이 통과하는 유저. */
    private User pushableUser(String nickname) {
        // 닉네임은 유니크할 수 있어(users.nickname 조회 경로 존재) 다른 테스트와 겹치지 않게 접미사를 붙인다.
        User user = userRepository.save(User.builder()
                .nickname(nickname + "-" + UUID.randomUUID())
                .isGuest(false)
                .deviceToken("token-" + UUID.randomUUID())
                .build());
        userNotificationSettingsRepository.save(UserNotificationSettings.builder()
                .userId(user.getId())
                .notificationEnabled(true)
                .soundEnabled(true)
                .nightModeEnabled(true)
                .nightStartTime(LocalTime.MIDNIGHT)
                .nightEndTime(LocalTime.MIDNIGHT)
                .build());
        users.add(user);
        return user;
    }

    private UUID pendingRequestId() {
        List<Friendship> pending = friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(
                sender, FriendshipStatus.PENDING);
        assertThat(pending).hasSize(1);
        return pending.get(0).getId();
    }

    /** 요청 푸시가 DB에 남을 때까지 기다린다 — 후속 상태 전이 커밋이 요청 푸시를 생략시키는 경합 차단. */
    private void awaitFriendRequestPushLogged() {
        await().atMost(DEADLINE).untilAsserted(() ->
                assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).hasSize(1));
    }

    private List<NotificationSentLog> sentLogs(String type) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                type, users.stream().map(User::getId).toList(), Instant.EPOCH);
    }
}
