package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 스크린타임 권한 행 잠금이 <b>실제로</b> 걸리는지 확인한다 (Testcontainers PostgreSQL).
 *
 * <p>SCREEN_TIME 회차 참여 가드(N50, GROMO-1409)는 "권한 true 확인 → 참가비 차감"의 check-then-act
 * 다. 잠금이 없으면 그 사이에 권한 회수({@code UserService.updateScreenTimePermission})가 커밋돼
 * <b>보고 수단이 없는 유저가 유료 회차에 남는다</b>(미보고 = 미달성이라 확정 패배). 방어가
 * {@code SELECT … FOR SHARE} / {@code FOR UPDATE} 한 쌍에 걸려 있어 애노테이션이 조용히 무시되면
 * 가드가 통째로 무력화되므로, 락 자체를 테스트한다({@code GroupChallengeLockIntegrationTest} 선례).
 *
 * <p>{@code @Transactional} 을 붙이지 않는다 — 다른 커넥션이 그 행을 볼 수 있어야 락 경합이
 * 성립하므로 픽스처가 커밋돼 있어야 하고, 뒷정리는 직접 한다.
 */
class UserScreenTimeSettingsLockIntegrationTest extends IntegrationTestBase {

    @Autowired
    UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    DataSource dataSource;

    private static final long TIMEOUT_SECONDS = 10;

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("권한유저").isGuest(false).build());
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(user.getId()).screenTimePermissionGranted(true).build());
    }

    @AfterEach
    void tearDown() {
        userScreenTimeSettingsRepository.findById(user.getId())
                .ifPresent(userScreenTimeSettingsRepository::delete);
        userRepository.delete(user);
    }

    @Test
    @DisplayName("findByIdForShare — 참여 가드의 공유 잠금이 권한 회수(배타 잠금)를 대기시킨다")
    void shareLockBlocksPermissionRevoke() throws Exception {
        assertRowLockHeld(() -> assertThat(userScreenTimeSettingsRepository
                .findByIdForShare(user.getId()))
                .get()
                .returns(true, UserScreenTimeSettings::isScreenTimePermissionGranted));
    }

    @Test
    @DisplayName("findByIdForUpdate — 권한 회수의 배타 잠금이 걸려 참여 가드의 읽기를 대기시킨다")
    void updateLockBlocksJoinGuardRead() throws Exception {
        assertRowLockHeld(() -> {
            UserScreenTimeSettings settings = userScreenTimeSettingsRepository
                    .findByIdForUpdate(user.getId()).orElseThrow();
            settings.setScreenTimePermissionGranted(false);
        });
    }

    /**
     * {@code lockingRead} 를 트랜잭션 안에서 실행해 잠금을 쥔 채, 다른 커넥션이 같은 행을
     * {@code FOR UPDATE NOWAIT} 로 잡아 보게 한다 — 잠겨 있으면 대기 없이 55P03 으로 튕긴다.
     * (운영 경로는 NOWAIT 가 아니라 대기하지만, 여기서는 "잠겨 있음"을 결정적으로 확인하려는 것이다.)
     */
    private void assertRowLockHeld(Runnable lockingRead) throws Exception {
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<?> holder = pool.submit(() -> new TransactionTemplate(transactionManager).execute(status -> {
                lockingRead.run();
                locked.countDown();
                awaitQuietly(release);
                return null;
            }));
            assertThat(locked.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isTrue();

            assertThatThrownBy(this::lockRowWithoutWaiting).isInstanceOf(SQLException.class);

            release.countDown();
            holder.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private void lockRowWithoutWaiting() throws SQLException {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "select user_id from user_screen_time_settings where user_id = ? for update nowait")) {
            statement.setObject(1, user.getId());
            statement.executeQuery().close();
        }
    }

    private static void awaitQuietly(CountDownLatch latch) {
        try {
            latch.await(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
