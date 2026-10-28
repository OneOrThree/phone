package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.service.FriendService;
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
        return jwt.extractUserId(auth.guestSession(UUID.randomUUID().toString()).accessToken());
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

}
