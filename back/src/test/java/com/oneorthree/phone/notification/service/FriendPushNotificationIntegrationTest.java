package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.notification.config.NotificationAsyncConfig;
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
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

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
    @Autowired
    @Qualifier(NotificationAsyncConfig.PUSH_EXECUTOR)
    Executor pushExecutor;

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
        awaitNotificationsDrained();

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
        long submittedBefore = submittedNotificationTasks();
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            friendService.createRequest(sender.getId(), receiver.getId());
            status.setRollbackOnly();
        });

        // 발송 작업 제출은 커밋 스레드에서 동기로 일어난다 — 롤백이면 제출 자체가 없어야 하고,
        // 이 단정은 대기 없이도 성립한다(뒤늦게 제출될 여지가 없다).
        assertThat(submittedNotificationTasks()).isEqualTo(submittedBefore);
        assertThat(friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(
                sender, FriendshipStatus.PENDING)).isEmpty();
        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).isEmpty();
    }

    @Test
    @DisplayName("수락이 커밋되면 요청을 보냈던 쪽에 발송 기록이 남는다")
    void acceptRequest_committed_sendsToRequester() {
        friendService.createRequest(sender.getId(), receiver.getId());

        friendService.acceptRequest(receiver.getId(), pendingRequestId());
        awaitNotificationsDrained();

        List<NotificationSentLog> logs = sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED);
        assertThat(logs).singleElement()
                .satisfies(sentLog -> {
                    assertThat(sentLog.getUserId()).isEqualTo(sender.getId());
                    assertThat(sentLog.getTargetUserId()).isEqualTo(receiver.getId());
                });
    }

    @Test
    @DisplayName("같은 수락이 두 번 들어와도 발송은 한 번뿐이다 — 두 번째는 상태 전이가 아니다")
    void acceptRequest_twice_sendsOnce() {
        // acceptRequest 는 현재 상태를 검사하지 않고 ACCEPTED 를 덮어쓴다. 이벤트 발행을 실제 상태
        // 전이로 제한하지 않으면 클라 재시도·연타가 그대로 두 번째 푸시가 된다(@codex 리뷰).
        friendService.createRequest(sender.getId(), receiver.getId());
        UUID requestId = pendingRequestId();

        friendService.acceptRequest(receiver.getId(), requestId);
        friendService.acceptRequest(receiver.getId(), requestId);
        awaitNotificationsDrained();

        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).hasSize(1);
    }

    @Test
    @DisplayName("거절은 어느 쪽에도 알리지 않는다")
    void rejectRequest_sendsNothing() {
        friendService.createRequest(sender.getId(), receiver.getId());

        friendService.rejectRequest(receiver.getId(), pendingRequestId());
        awaitNotificationsDrained();

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

    /** 제출된 발송 작업이 전부 끝날 때까지 기다린다. 제출은 커밋 스레드에서 동기로 일어나 경합이 없다. */
    private void awaitNotificationsDrained() {
        ThreadPoolExecutor pool = ((ThreadPoolTaskExecutor) pushExecutor).getThreadPoolExecutor();
        long deadline = System.currentTimeMillis() + 5_000;
        while (pool.getCompletedTaskCount() < pool.getTaskCount()
                && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("발송 대기 중 인터럽트", e);
            }
        }
        assertThat(pool.getCompletedTaskCount())
                .as("5초 안에 발송 작업이 끝나야 한다")
                .isEqualTo(pool.getTaskCount());
    }

    private long submittedNotificationTasks() {
        return ((ThreadPoolTaskExecutor) pushExecutor).getThreadPoolExecutor().getTaskCount();
    }

    private List<NotificationSentLog> sentLogs(String type) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                type, users.stream().map(User::getId).toList(), Instant.EPOCH);
    }
}
