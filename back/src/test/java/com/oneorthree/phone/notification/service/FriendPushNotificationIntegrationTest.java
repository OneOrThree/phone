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

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

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

        // 발송은 별도 스레드라 긍정 단정은 DB 사후조건을 직접 기다린다 — executor 카운터 교차 비교는
        // 조기 탈출 창이 있어 신뢰할 수 없다(awaitNotificationsDrained 주석, GROMO-1228).
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
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
        awaitFriendRequestPushLogged();

        friendService.acceptRequest(receiver.getId(), pendingRequestId());

        // 긍정 단정은 DB 사후조건을 직접 기다린다 (createRequest_committed_sendsToReceiver 와 같은 이유)
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
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
        long completedBase = completedNotificationTasks();
        long submittedBase = submittedNotificationTasks();
        friendService.createRequest(sender.getId(), receiver.getId());
        awaitFriendRequestPushLogged();
        // 요청 작업의 **완료**까지 기다려 유휴 기준선을 만든다 — DB 가시성(커밋은 작업 본체 안)은
        // 완료 카운터 증가(작업 리턴 후)보다 앞설 수 있어, 여기서 끊지 않으면 요청 작업의 뒤늦은
        // 완료가 아래 델타 대기를 대신 만족시켜 수락 작업 완료 전에 단언이 달린다(codex 리뷰).
        // DB 행이 보이는 시점엔 작업이 실행 중(isLocked) 아니면 완료라 제출 수 읽기도 안전하다.
        awaitNotificationsDrained(completedBase, submittedBase);
        UUID requestId = pendingRequestId();

        long completedBefore = completedNotificationTasks();
        long submittedBefore = submittedNotificationTasks();
        friendService.acceptRequest(receiver.getId(), requestId);
        friendService.acceptRequest(receiver.getId(), requestId);
        awaitNotificationsDrained(completedBefore, submittedBefore);

        // untilAsserted(hasSize(1)) 로 바꾸면 안 된다 — 첫 발송이 남는 순간 통과해, 지연 도착하는
        // 두 번째 발송(회귀)을 놓친다. 제출분 전부 완료를 보장한 뒤에야 "정확히 1건" 단언이 유효하다.
        // 드레인의 제출 수 스냅샷이 과소 계수 창에 걸린 극히 드문 경우를 대비해, 보장된 1건이
        // 실제로 남을 때까지는 별도로 기다린다(정상 코드에선 두 번째 작업 자체가 없어 개수는 안정).
        await().atMost(Duration.ofSeconds(5))
                .until(() -> !sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED).isEmpty());
        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).hasSize(1);
    }

    @Test
    @DisplayName("거절은 어느 쪽에도 알리지 않는다")
    void rejectRequest_sendsNothing() {
        // 요청 푸시가 먼저 남을 때까지 기다린다 — 발송이 비동기라, 거절이 먼저 커밋되면 요청 푸시가
        // "이미 처리된 요청" 으로 생략될 수 있다(그 자체는 정상 동작이지만 아래 단정이 흔들린다).
        long completedBase = completedNotificationTasks();
        long submittedBase = submittedNotificationTasks();
        friendService.createRequest(sender.getId(), receiver.getId());
        awaitFriendRequestPushLogged();
        // 요청 작업의 완료까지 기준선으로 확보 — 사유는 acceptRequest_twice_sendsOnce 의 주석 참조
        // (요청 작업의 뒤늦은 완료가 아래 델타 대기를 대신 만족시키는 것 차단, codex 리뷰).
        awaitNotificationsDrained(completedBase, submittedBase);

        long completedBefore = completedNotificationTasks();
        long submittedBefore = submittedNotificationTasks();
        friendService.rejectRequest(receiver.getId(), pendingRequestId());
        // 거절이 뭔가를 제출했다면(회귀) 그 완료까지 기다린 뒤에 "안 나갔다"를 단언한다.
        awaitNotificationsDrained(completedBefore, submittedBefore);

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

    /** 요청 푸시가 DB에 남을 때까지 기다린다 — 후속 상태 전이 커밋이 요청 푸시를 생략시키는 경합 차단. */
    private void awaitFriendRequestPushLogged() {
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).hasSize(1));
    }

    /**
     * 스냅샷 이후 제출된 발송 작업이 전부 완료될 때까지 기다린다.
     *
     * <p><b>{@code getCompletedTaskCount()} 와 {@code getTaskCount()} 를 같은 시점에 교차 비교하지 말
     * 것 — GROMO-1228 플레이크의 원인.</b> {@code getTaskCount()} 는 문서화된 근사치라, 워커가 큐에서
     * 작업을 꺼낸 직후(워커 락 획득 전) 짧은 창에서는 그 작업이 큐에도 실행 중에도 계수되지 않는다.
     * 이 창에서 읽으면 일시적으로 {@code completed == taskCount} 가 되어 "다 끝났다"로 오판하고,
     * 단언 시점엔 창이 닫혀 {@code expected <N+1> but was <N>} 로 터진다. 그래서 여기서는
     * ① 제출 직전 완료 수를 스냅샷하고 ② 제출 수 델타만큼 완료가 늘 때까지만 기다린다 —
     * {@code getCompletedTaskCount()} 는 JDK 가 단조 증가를 보장하는 유일한 카운터라 이 비교는
     * 창의 영향을 받지 않는다. 제출 수 델타는 제출이 커밋 스레드에서 동기로 끝난 직후 읽는다.
     */
    private void awaitNotificationsDrained(long completedBefore, long submittedBefore) {
        long submitted = submittedNotificationTasks() - submittedBefore;
        await().atMost(Duration.ofSeconds(5))
                .until(() -> completedNotificationTasks() - completedBefore >= submitted);
    }

    private long completedNotificationTasks() {
        return pushPool().getCompletedTaskCount();
    }

    private long submittedNotificationTasks() {
        return pushPool().getTaskCount();
    }

    private ThreadPoolExecutor pushPool() {
        return ((ThreadPoolTaskExecutor) pushExecutor).getThreadPoolExecutor();
    }

    private List<NotificationSentLog> sentLogs(String type) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                type, users.stream().map(User::getId).toList(), Instant.EPOCH);
    }
}
