package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.service.ChallengeResultAckService;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository.SnapshotRank;
import com.oneorthree.phone.league.repository.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.service.LeagueService;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 탈퇴 파기를 되돌릴 수 있는 writer 들의 활성 사용자 공유 락 (GROMO-1944 · 계정 LLD §4).
 *
 * <p>각 테스트는 같은 경합을 재현한다 — 탈퇴 TX 가 파기를 끝내고 <b>커밋 직전에 멈춘</b> 동안 writer 가 들어온다.
 * writer 의 락 없는 활성 검사는 아직 커밋 안 된 탈퇴를 못 보므로 통과한다. 공유 락이 있으면 writer 는 탈퇴 커밋을
 * 기다렸다가 404 가 되고(비동기·배치 writer 는 건너뛴다), 없으면 탈퇴가 지운 행을 다시 쓴다. 탈퇴가 먼저 커밋되고
 * writer 가 그 뒤에 판정받는 순서를 서버 잠금 상태로 고정하므로, 락을 빼면 이 테스트들이 실패한다.
 */
@SpringBootTest
class WithdrawalWriterFenceIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired AccountWithdrawalService withdrawal;
    @Autowired FriendService friends;
    @Autowired ChallengeResultAckService resultAcks;
    @Autowired LeagueRankSnapshotUpsertRepository snapshots;
    @Autowired LeagueService league;
    @Autowired FriendNotificationService friendNotifications;
    @Autowired FocusService focus;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @PersistenceContext EntityManager em;

    @Test
    @DisplayName("친구 삭제 — 탈퇴 커밋 뒤 404 이고 파기한 관계 행이 남지 않는다")
    void deleteFriend() throws Exception {
        UUID w = actor();
        UUID c = actor();
        inTx(() -> em.persist(Friendship.builder().fromUser(user(w)).toUser(user(c))
                .status(FriendshipStatus.ACCEPTED).build()));

        Throwable thrown = writerRacingWithdrawal(w, () -> friends.deleteFriend(w, c));

        assertUserNotFound(thrown);
        assertThat(count("select count(*) from friendships where from_user_id=? or to_user_id=?", w, w)).isZero();
    }

    @Test
    @DisplayName("결과 표시 선점 — 탈퇴 커밋 뒤 404 이고 비운 lease 가 되살아나지 않는다")
    void claimDisplay() throws Exception {
        UUID w = actor();
        UUID session = settledSessionWith(w, null);

        Throwable thrown = writerRacingWithdrawal(w, () -> resultAcks.claimDisplay(w, session, null));

        assertUserNotFound(thrown);
        assertThat(jdbc.queryForMap("select display_claim_token, display_claimed_at from"
                + " group_challenge_bet_participants where session_id=? and user_id=?", session, w))
                .containsEntry("display_claim_token", null).containsEntry("display_claimed_at", null);
    }

    @Test
    @DisplayName("결과 확인 — 탈퇴 커밋 뒤 404 이고 비운 확인 시각이 되살아나지 않는다")
    void acknowledgeResult() throws Exception {
        UUID w = actor();
        UUID token = UUID.randomUUID();
        UUID session = settledSessionWith(w, token);

        Throwable thrown = writerRacingWithdrawal(w, () -> resultAcks.acknowledge(w, session, token));

        assertUserNotFound(thrown);
        assertThat(jdbc.queryForMap("select acknowledged_at from group_challenge_bet_participants"
                + " where session_id=? and user_id=?", session, w)).containsEntry("acknowledged_at", null);
    }

    @Test
    @DisplayName("리그 순위 스냅샷 — 탈퇴한 사용자의 줄만 빠지고 파기한 스냅샷이 되살아나지 않는다")
    void rankSnapshotUpsert() throws Exception {
        UUID w = actor();
        UUID c = actor();
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        inTx(() -> em.persist(LeagueRankSnapshot.builder().userId(w).rank(5).createdAt(today).build()));

        Throwable thrown = writerRacingWithdrawal(w, () -> snapshots.upsertAll(today,
                List.of(new SnapshotRank(w, 1), new SnapshotRank(c, 2))));

        assertThat(thrown).isNull();
        assertThat(count("select count(*) from league_rank_snapshots where user_id=?", w)).isZero();
        assertThat(count("select count(*) from league_rank_snapshots where user_id=? and rank=2", c)).isEqualTo(1L);
    }

    @Test
    @DisplayName("리그 주간 결과 확인 — 탈퇴 커밋 뒤 404 이고 완료 마커의 확인 시각이 비어 있다")
    void acknowledgeWeeklyResult() throws Exception {
        UUID w = actor();
        Instant week = Instant.now().minus(7, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        inTx(() -> em.persist(LeagueWeeklyResult.builder().user(user(w)).weekStartAt(week).previousTierLevel(1)
                .newTierLevel(2).result(LeagueWeeklyResultType.PROMOTED).focusSeconds(3600).build()));

        Throwable thrown = writerRacingWithdrawal(w, () -> league.acknowledgeLastResult(w, week));

        assertUserNotFound(thrown);
        assertThat(jdbc.queryForMap("select acknowledged_at, result from league_weekly_results where user_id=?", w))
                .containsEntry("acknowledged_at", null).containsEntry("result", null);
    }

    @Test
    @DisplayName("친구 알림 기록(탈퇴자가 수신자) — 푸시 뒤 탈퇴가 커밋되면 발송 이력을 남기지 않는다")
    void friendNotificationLogForWithdrawnRecipient() throws Exception {
        UUID w = actor();
        UUID c = actor();
        reachable(w);
        reachable(c);

        Throwable thrown = writerRacingWithdrawal(w, () -> friendNotifications.notifyFriendAccepted(w, c));

        assertThat(thrown).isNull();
        assertThat(count("select count(*) from notification_sent_logs where user_id=?", w)).isZero();
    }

    @Test
    @DisplayName("친구 알림 기록(탈퇴자가 상대) — 푸시 뒤 탈퇴가 커밋되면 탈퇴자를 가리키는 이력을 남기지 않는다")
    void friendNotificationLogAboutWithdrawnCounterpart() throws Exception {
        UUID w = actor();
        UUID c = actor();
        reachable(w);
        reachable(c);

        Throwable thrown = writerRacingWithdrawal(w, () -> friendNotifications.notifyFriendAccepted(c, w));

        assertThat(thrown).isNull();
        assertThat(count("select count(*) from notification_sent_logs where target_user_id=?", w)).isZero();
    }

    @Test
    @DisplayName("집중 태그 이름 변경 — 탈퇴 커밋 뒤 404 이고 파기한 채택 행이 되살아나지 않는다")
    void updateFocusTag() throws Exception {
        UUID w = actor();
        UUID tag = inTx(() -> {
            DefaultTag name = DefaultTag.builder().name("태그" + suffix()).build();
            em.persist(name);
            UserFocusTag adopted = UserFocusTag.builder().user(user(w)).defaultTag(name).build();
            em.persist(adopted);
            return adopted.getId();
        });

        Throwable thrown = writerRacingWithdrawal(w,
                () -> focus.updateFocusTag(w, new FocusTagUpdateRequest(tag, "새이름" + suffix())));

        assertUserNotFound(thrown);
        assertThat(count("select count(*) from user_focus_tags where user_id=?", w)).isZero();
    }

    // ---------------------------------------------------------------- 경합 재현

    /**
     * 탈퇴 TX 를 파기 직후·커밋 직전에 세워 두고 writer 를 들여보낸 뒤, writer 가 탈퇴 연결이 쥔 잠금에 막히면
     * (또는 막히지 않고 끝나면) 탈퇴를 커밋시킨다.
     *
     * @return writer 가 던진 예외. 정상 종료면 {@code null}
     */
    private Throwable writerRacingWithdrawal(UUID withdrawing, Runnable writer) throws Exception {
        CountDownLatch erased = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger withdrawalPid = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> withdrawalTx = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(s -> {
                withdrawal.withdraw(withdrawing);
                withdrawalPid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                erased.countDown();
                awaitQuietly(release);
            }));
            assertThat(erased.await(60, TimeUnit.SECONDS)).isTrue();
            Future<Throwable> writing = pool.submit(() -> {
                try {
                    writer.run();
                    return null;
                } catch (RuntimeException failure) {
                    return failure;
                }
            });
            awaitBlockedOrDone(withdrawalPid.get(), writing);
            release.countDown();
            withdrawalTx.get(60, TimeUnit.SECONDS);
            return writing.get(60, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private void awaitBlockedOrDone(int holderPid, Future<?> writing) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        while (System.nanoTime() < deadline && !writing.isDone()) {
            Long blocked = jdbc.queryForObject("select count(*) from pg_stat_activity"
                    + " where ? = any(pg_blocking_pids(pid))", Long.class, holderPid);
            if (blocked != null && blocked > 0) {
                return;
            }
            Thread.sleep(10);
        }
    }

    private static void awaitQuietly(CountDownLatch latch) {
        try {
            latch.await(60, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    // ---------------------------------------------------------------- 픽스처

    private UUID actor() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    /** 푸시가 실제로 나가는 상태 — 기기 토큰과 문구에 들어갈 닉네임. */
    private void reachable(UUID userId) {
        inTx(() -> {
            User user = user(userId);
            user.setNickname("알림" + suffix());
            user.setDeviceToken("token-" + userId);
            return null;
        });
    }

    /** 정산 끝난 회차에 참가 행 하나. {@code claimToken} 이 있으면 그 토큰으로 선점된 상태다. */
    private UUID settledSessionWith(UUID userId, UUID claimToken) {
        return inTx(() -> {
            Instant past = Instant.now().minusSeconds(7200);
            Group group = Group.builder().name("선점" + suffix()).maxMembers(10).build();
            em.persist(group);
            GroupChallenge challenge = GroupChallenge.builder().group(group).category(MissionCategory.SCREEN_TIME)
                    .type(MissionType.TIME_WINDOW).build();
            em.persist(challenge);
            GroupChallengeBet bet = GroupChallengeBet.builder().group(group).challenge(challenge).stake(100)
                    .enabled(true).build();
            em.persist(bet);
            GroupChallengeBetSession session = GroupChallengeBetSession.builder().bet(bet).group(group)
                    .challenge(challenge).sessionDate(LocalDate.now(ZoneOffset.UTC).minusDays(1)).stake(100)
                    .goalMinutes(30).missionCategory(MissionCategory.SCREEN_TIME).missionType(MissionType.TIME_WINDOW)
                    .status(GroupBetStatus.SETTLED).settledAt(past)
                    .startsAt(past.minusSeconds(3600)).joinClosesAt(past).closesAt(past).settleAfter(past).build();
            em.persist(session);
            em.persist(GroupChallengeBetParticipant.builder().session(session).user(user(userId))
                    .achieved(true).payout(200).progressMinutes(10)
                    .displayClaimToken(claimToken).displayClaimedAt(claimToken == null ? null : Instant.now())
                    .build());
            return session.getId();
        });
    }

    private User user(UUID id) {
        return em.find(User.class, id);
    }

    private <T> T inTx(java.util.function.Supplier<T> work) {
        return new TransactionTemplate(transactions).execute(status -> work.get());
    }

    private void inTx(Runnable work) {
        new TransactionTemplate(transactions).executeWithoutResult(status -> work.run());
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private static void assertUserNotFound(Throwable thrown) {
        assertThat(thrown).isInstanceOf(UserException.class);
        assertThat(((UserException) thrown).getErrorCode()).isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 6);
    }
}
