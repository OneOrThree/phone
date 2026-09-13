package com.oneorthree.phone.user.service;

import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 알림 설정의 <b>상태 판독 직렬화</b> — 행과 봉투가 갈라지지 않는지 (A22 ㋕, GROMO-1659).
 *
 * <p>실물 PostgreSQL + 실제 Flyway 위에서 <b>두 커넥션</b>으로 돈다. 한 스레드 안에서 순서를 바꿔
 * 흉내 내거나 목으로 대체하면 잠금이 전혀 관여하지 않아, 정작 잠금이 빠져도 초록이 된다. 그래서
 * 「경합 창에 실제로 들어왔는가」를 {@code pg_stat_activity} · {@code pg_blocking_pids} 로 직접 묻고,
 * 그 확인 뒤에만 단정한다 — 타임아웃만으로는 스레드가 아직 출발도 안 했는지 구분되지 않는다.
 */
@SpringBootTest
class NotificationSettingsSerializationConcurrencyTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    UserRepository userRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    UserSatelliteCommandService userSatelliteCommandService;
    @Autowired
    UserService userService;
    @Autowired
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    DataSource dataSource;
    @PersistenceContext
    EntityManager entityManager;

    @Test
    @DisplayName("끄기 «도중» 도착한 「켜짐 유지」 명령은 행도 같이 켠다 — 잠금 전에 읽으면 UPDATE 가 생략된다")
    void keepEnabledCommandRacingADisableStillWritesTheRow() throws Exception {
        UUID userId = newUser();

        ExecutorService pool = Executors.newSingleThreadExecutor();
        AtomicReference<Future<Long>> keepRef = new AtomicReference<>();
        AtomicInteger keepPid = new AtomicInteger();
        CountDownLatch keepStarted = new CountDownLatch(1);
        try {
            // ① 「끄기」 트랜잭션이 «커밋 전» 상태로 설정 행 잠금만 쥔다. 테스트가 직접 트랜잭션을
            //    열어야 두 커넥션의 시점이 겹친다 — latch 로 동시에 출발만 시키면 잠금이 빠져도
            //    우연히 초록이 된다.
            Long disableVersion = tx().execute(status -> {
                int disablePid = backendPid();
                long version = userSatelliteCommandService
                        .recordNotificationSettings(userId, settings(false), "race-disable").version();

                // ② 그 사이 «다른 멱등 키»의 「켜짐 유지」가 들어온다. 옛 구현은 여기서 잠금 없이
                //    상태를 읽어 켜짐(초기값)을 스냅샷으로 잡고, 그 뒤 version 발급에서만 멈췄다.
                // ⚠️ PID 는 «실제로 일할 그 트랜잭션 안»에서 잡는다. 먼저 짧은 트랜잭션으로 PID 만
                //    읽고 끝내면 그 커넥션이 풀로 돌아가, 뒤이은 명령이 다른 커넥션에서 돌아도
                //    테스트가 초록이 된다 — 차단 관측이 Hikari 의 우연한 재사용에 기대게 된다.
                Future<Long> keep = pool.submit(() -> tx().execute(inner -> {
                    keepPid.set(backendPid());
                    keepStarted.countDown();
                    return userSatelliteCommandService
                            .recordNotificationSettings(userId, settings(true), "race-keep-enabled").version();
                }));
                keepRef.set(keep);

                try {
                    assertThat(keepStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(keepPid.get(), disablePid);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(e);
                } catch (SQLException e) {
                    throw new IllegalStateException(e);
                }
                // 잠금을 쥔 채로는 아직 끝나지 않는다 — 「정말 이 트랜잭션이 막고 있다」의 확인이다.
                assertThatThrownBy(() -> keep.get(1, TimeUnit.SECONDS)).isInstanceOf(TimeoutException.class);
                return version;
            });

            // ③ 끄기가 커밋된 뒤 「켜짐 유지」가 깨어난다. 잠금 뒤에 읽으므로 이제 «꺼짐»을 보고,
            //    켬으로 바꾸는 것이 실제 더티 UPDATE 가 된다. 옛 구현은 스냅샷이 이미 켜짐이라
            //    UPDATE 를 생략했고, 행은 꺼짐 · 봉투는 더 높은 version 의 켬으로 갈라졌다.
            long keepVersion = keepRef.get().get(30, TimeUnit.SECONDS);
            assertThat(keepVersion).isGreaterThan(disableVersion);

            boolean rowEnabled = tx().execute(status ->
                    userNotificationSettingsRepository.findById(userId).orElseThrow().isNotificationEnabled());
            // 가장 높은 version 의 봉투가 곧 알림 서버의 최종 상태다. 행이 그것과 같아야 한다.
            assertThat(latestSettingsEnvelope(userId).getParams().get("notificationEnabled")).isEqualTo(true);
            assertThat(rowEnabled).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("위성 명령 «도중» 들어온 공개 설정 저장은 커밋 뒤의 상태를 읽는다 — 두 번째 쓰기 주체")
    void legacyPublicSaveRacingTheSatelliteCommandReadsTheCommittedState() throws Exception {
        UUID userId = newUser();

        ExecutorService pool = Executors.newSingleThreadExecutor();
        AtomicReference<Future<?>> saveRef = new AtomicReference<>();
        AtomicInteger savePid = new AtomicInteger();
        CountDownLatch saveStarted = new CountDownLatch(1);
        try {
            tx().executeWithoutResult(status -> {
                int commandPid = backendPid();
                userSatelliteCommandService.recordNotificationSettings(userId, settings(false), "legacy-race");

                // 공개 PUT /users/me/notification-settings 도 같은 내구 명령에 위임한다. 잠금 없이
                // 읽으면 위성 커밋 뒤에 옛 스냅샷으로 전 컬럼 UPDATE 를 내 행과 봉투가 갈라진다.
                // PID 는 위와 같은 이유로 «일하는 트랜잭션 안»에서 잡는다.
                Future<?> save = pool.submit(() -> tx().execute(inner -> {
                    savePid.set(backendPid());
                    saveStarted.countDown();
                    userService.updateNotificationSettings(userId, settings(true));
                    return null;
                }));
                saveRef.set(save);

                try {
                    assertThat(saveStarted.await(10, TimeUnit.SECONDS)).isTrue();
                    awaitBlockedBy(savePid.get(), commandPid);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(e);
                } catch (SQLException e) {
                    throw new IllegalStateException(e);
                }
                assertThatThrownBy(() -> save.get(1, TimeUnit.SECONDS)).isInstanceOf(TimeoutException.class);
            });

            saveRef.get().get(30, TimeUnit.SECONDS);

            // 나중에 커밋한 쪽이 이긴다 — 「경합이면 전부 막는다」가 아니다. 중요한 건 그 값이
            // «읽은 상태 → 새 상태» 판정을 거친 결과라는 것이다.
            UserNotificationSettings after = tx().execute(status ->
                    userNotificationSettingsRepository.findById(userId).orElseThrow());
            assertThat(after.isNotificationEnabled()).isTrue();
            // 두 writer 모두 같은 내구 명령을 사용하므로 공개 저장도 새 버전의 봉투를 남긴다.
            List<EventOutbox> envelopes = settingsEnvelopes(userId);
            assertThat(envelopes).hasSize(2);
            EventOutbox latest = latestSettingsEnvelope(userId);
            assertThat(latest.getVersion()).isGreaterThan(envelopes.stream()
                    .mapToLong(EventOutbox::getVersion).min().orElseThrow());
            assertThat(latest.getParams().get("notificationEnabled"))
                    .isEqualTo(after.isNotificationEnabled());
        } finally {
            pool.shutdownNow();
        }
    }

    /** 지금 트랜잭션이 쥐고 있는 커넥션의 PostgreSQL 백엔드 PID. */
    private int backendPid() {
        return ((Number) entityManager.createNativeQuery("SELECT pg_backend_pid()")
                .getSingleResult()).intValue();
    }

    /**
     * {@code blockedPid} 백엔드가 <b>실제로</b> 잠금을 기다리고 있고 그 차단자에 {@code blockerPid} 가
     * 들어 있을 때까지 기다린다 — 관측은 «제3의 커넥션»으로 한다(당사자 둘은 모두 대기 중이다).
     *
     * @throws AssertionError 제한 시간 안에 그 상태를 못 보면 경합 창을 통과하지 못한 것이다
     */
    private void awaitBlockedBy(int blockedPid, int blockerPid) throws SQLException, InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        String lastWait = null;
        List<Integer> lastBlockers = List.of();
        try (Connection observer = dataSource.getConnection();
                PreparedStatement query = observer.prepareStatement(
                        "SELECT wait_event_type, pg_blocking_pids(pid) FROM pg_stat_activity WHERE pid = ?")) {
            while (System.nanoTime() < deadline) {
                query.setInt(1, blockedPid);
                try (ResultSet row = query.executeQuery()) {
                    if (row.next()) {
                        lastWait = row.getString(1);
                        Array blockers = row.getArray(2);
                        lastBlockers = blockers == null ? List.of() : List.of((Integer[]) blockers.getArray());
                        if ("Lock".equals(lastWait) && lastBlockers.contains(blockerPid)) {
                            return;
                        }
                    }
                }
                TimeUnit.MILLISECONDS.sleep(100);
            }
        }
        throw new AssertionError("두 번째 설정 쓰기가 잠금 대기에 도달하지 않았다 — wait_event_type="
                + lastWait + " blocking_pids=" + lastBlockers + " (기대 차단자 " + blockerPid + ")");
    }

    private List<EventOutbox> settingsEnvelopes(UUID userId) {
        return tx().execute(status -> eventOutboxRepository.findAll().stream()
                .filter(row -> userId.equals(row.getUserId()))
                .filter(row -> UserSatelliteCommandService.EVENT_SETTINGS_CHANGED.equals(row.getType()))
                .toList());
    }

    /** 가장 높은 version 의 설정 봉투 — 위성이 최종으로 적용할 바로 그 값이다. */
    private EventOutbox latestSettingsEnvelope(UUID userId) {
        return settingsEnvelopes(userId).stream()
                .max(Comparator.comparingLong(EventOutbox::getVersion))
                .orElseThrow();
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static NotificationSettingsRequest settings(boolean enabled) {
        NotificationSettingsRequest request = new NotificationSettingsRequest();
        ReflectionTestUtils.setField(request, "notificationEnabled", enabled);
        ReflectionTestUtils.setField(request, "soundEnabled", true);
        ReflectionTestUtils.setField(request, "nightModeEnabled", false);
        return request;
    }

    /** 초기 상태는 «켜짐»이다 — 결함 재현의 전제(켜짐에서 끄기와 켜짐 유지가 겹친다). */
    private UUID newUser() {
        return tx().execute(status -> {
            User user = userRepository.save(User.builder().build());
            userNotificationSettingsRepository.save(
                    UserNotificationSettings.builder().userId(user.getId()).build());
            return user.getId();
        });
    }
}
