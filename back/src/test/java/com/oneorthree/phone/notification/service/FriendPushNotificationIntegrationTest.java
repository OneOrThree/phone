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
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executor;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

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

    // ── 대기 전략 (GROMO-1228, codex 3라운드) ─────────────────────────────
    // executor 카운터는 어떤 조합으로도 결정적 드레인이 안 된다 — getTaskCount() 는 문서화된
    // 근사치라 워커가 큐에서 작업을 꺼낸 직후(락 획득 전) 창에서 실행 중 작업이 계수되지 않고,
    // 그 창은 "제출 직후"든 "DB 가시 이후"든 어느 읽기 시점에나 걸릴 수 있다. 시간 유지(during)
    // 대기도 상한 증명이 아니다 — 공유 풀이 밀려 있으면 지연 중복이 유지 시간 뒤에 올 수 있다.
    // 그래서 **정지 펜스**(awaitPushQuiescent)를 쓴다: 제출은 커밋 스레드에서 동기로 일어나므로
    // (afterCommit 리스너의 execute 호출) 회귀로 늘어난 중복 제출도 펜스 제출보다 먼저 FIFO 큐에
    // 들어가 있고, 펜스 통과 뒤의 단언은 순간 스냅샷으로도 정확하다.
    private static final Duration DEADLINE = Duration.ofSeconds(10);

    @Test
    @DisplayName("친구 요청이 커밋되면 받은 쪽에 발송 기록이 남는다")
    void createRequest_committed_sendsToReceiver() {
        friendService.createRequest(sender.getId(), receiver.getId());
        awaitPushQuiescent();

        // 펜스 뒤라 순간 스냅샷으로 정확하다 — 한 커밋이 두 번 제출하는 회귀도 이미 완주해 있다.
        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).singleElement()
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
        // 롤백이면 제출 자체가 없어야 한다 — 회귀로 뭔가 제출됐더라도 펜스가 완주를 보장한 뒤
        // "비어 있음"을 단언하므로 놓치지 않는다.
        awaitPushQuiescent();

        assertThat(friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(
                sender, FriendshipStatus.PENDING)).isEmpty();
        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_REQUEST)).isEmpty();
    }

    @Test
    @DisplayName("수락이 커밋되면 요청을 보냈던 쪽에 발송 기록이 남는다")
    void acceptRequest_committed_sendsToRequester() {
        friendService.createRequest(sender.getId(), receiver.getId());
        // 요청 푸시를 먼저 완주시킨다 — 수락이 먼저 커밋되면 요청 푸시가 "이미 처리된 요청"으로
        // 생략될 수 있고(그 자체는 정상), 아래 ACCEPTED 단언과 무관한 잡음을 줄인다.
        awaitPushQuiescent();

        friendService.acceptRequest(receiver.getId(), pendingRequestId());
        awaitPushQuiescent();

        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).singleElement()
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
        awaitPushQuiescent();
        UUID requestId = pendingRequestId();

        friendService.acceptRequest(receiver.getId(), requestId);
        friendService.acceptRequest(receiver.getId(), requestId);
        // 회귀의 중복 제출은 두 번째 accept 커밋에서 동기로 끝나 펜스보다 먼저 큐에 들어가 있다 —
        // 펜스 통과 = 그 중복까지 완주 보장이라, "정확히 1건" 단언이 순간 스냅샷으로도 회귀를 잡는다.
        awaitPushQuiescent();

        assertThat(sentLogs(NotificationSentLog.TYPE_FRIEND_ACCEPTED)).hasSize(1);
    }

    @Test
    @DisplayName("거절은 어느 쪽에도 알리지 않는다")
    void rejectRequest_sendsNothing() {
        // 요청 푸시를 먼저 완주시킨다 — 거절이 먼저 커밋되면 요청 푸시가 "이미 처리된 요청"으로
        // 생략될 수 있다(그 자체는 정상 동작이지만 아래 REQUEST 1건 단정이 흔들린다).
        friendService.createRequest(sender.getId(), receiver.getId());
        awaitPushQuiescent();

        friendService.rejectRequest(receiver.getId(), pendingRequestId());
        // 거절이 뭔가를 제출하는 회귀도 커밋에서 동기 제출이 끝나 있다 — 펜스 뒤 부정 단언은 정확하다.
        awaitPushQuiescent();

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

    /**
     * 푸시 실행기 <b>정지 펜스</b> — 이 호출이 리턴하면, 호출 전에 제출된 발송 작업은 전부 완료돼
     * 있다(커밋 포함 — REQUIRES_NEW 커밋은 작업 본체 안에서 끝난다).
     *
     * <p>논증: 워커 수(maxPoolSize)만큼의 펜스 작업을 제출하고 배리어로 <b>전원 동시 시작</b>을
     * 강제한다. 배리어가 열렸다 = 모든 워커가 펜스를 실행 중이다 = 선행 작업이 워커를 점유하고
     * 있지 않다(FIFO 큐라 선행 작업은 펜스보다 먼저 뽑힌다). 카운터(getTaskCount 근사치)도 시간
     * 휴리스틱(during 유지)도 쓰지 않는 정확한 완료 신호다 — GROMO-1228 codex 3라운드.
     * 전제 2가지: 큐가 포화되면 드롭 정책이 펜스를 버려 타임아웃으로 실패한다(테스트 부하에선
     * 비현실적), 풀 크기가 바뀌면 maxPoolSize 를 따라간다.
     */
    private void awaitPushQuiescent() {
        ThreadPoolTaskExecutor pool = (ThreadPoolTaskExecutor) pushExecutor;
        int workers = pool.getMaxPoolSize();
        CyclicBarrier allWorkersOnFence = new CyclicBarrier(workers);
        List<Future<?>> fences = new ArrayList<>();
        for (int i = 0; i < workers; i++) {
            fences.add(pool.submit(() -> {
                try {
                    allWorkersOnFence.await(DEADLINE.toSeconds(), TimeUnit.SECONDS);
                } catch (Exception e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("푸시 정지 펜스 대기 실패", e);
                }
            }));
        }
        for (Future<?> fence : fences) {
            try {
                fence.get(DEADLINE.toSeconds(), TimeUnit.SECONDS);
            } catch (Exception e) {
                throw new IllegalStateException("푸시 정지 펜스가 제시간에 완료되지 않았다", e);
            }
        }
    }

    private List<NotificationSentLog> sentLogs(String type) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                type, users.stream().map(User::getId).toList(), Instant.EPOCH);
    }
}
