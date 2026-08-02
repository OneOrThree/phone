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

import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

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

    @Test
    @DisplayName("친구 요청이 커밋되면 받은 쪽에 발송 기록이 남는다")
    void createRequest_committed_sendsToReceiver() {
        friendService.createRequest(sender.getId(), receiver.getId());

        List<NotificationSentLog> logs = sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST);
        assertThat(logs).singleElement()
                .satisfies(sentLog -> {
                    assertThat(sentLog.getUserId()).isEqualTo(receiver.getId());
                    assertThat(sentLog.getTargetUserId()).isEqualTo(sender.getId());
                });
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
        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).isEmpty();
    }

    @Test
    @DisplayName("수락이 커밋되면 요청을 보냈던 쪽에 발송 기록이 남는다")
    void acceptRequest_committed_sendsToRequester() {
        friendService.createRequest(sender.getId(), receiver.getId());

        friendService.acceptRequest(receiver.getId(), pendingRequestId());

        List<NotificationSentLog> logs = sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED);
        assertThat(logs).singleElement()
                .satisfies(sentLog -> {
                    assertThat(sentLog.getUserId()).isEqualTo(sender.getId());
                    assertThat(sentLog.getTargetUserId()).isEqualTo(receiver.getId());
                });
    }

    @Test
    @DisplayName("같은 수락이 두 번 들어와도 발송은 한 번뿐이다 (dedup)")
    void acceptRequest_twice_sendsOnce() {
        // acceptRequest 는 현재 상태를 검사하지 않고 ACCEPTED 를 덮어쓴다 — 클라 재시도·연타가
        // 그대로 두 번째 이벤트가 되므로 dedup 이 유일한 방어다.
        friendService.createRequest(sender.getId(), receiver.getId());
        UUID requestId = pendingRequestId();

        friendService.acceptRequest(receiver.getId(), requestId);
        friendService.acceptRequest(receiver.getId(), requestId);

        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).hasSize(1);
    }

    @Test
    @DisplayName("거절은 어느 쪽에도 알리지 않는다")
    void rejectRequest_sendsNothing() {
        friendService.createRequest(sender.getId(), receiver.getId());

        friendService.rejectRequest(receiver.getId(), pendingRequestId());

        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).isEmpty();
        // 요청 시점의 1건 외에 늘어나지 않는다
        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).hasSize(1);
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

    private List<NotificationSentLog> sentLogs(String type) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                type, users.stream().map(User::getId).toList(), Instant.EPOCH);
    }
}
