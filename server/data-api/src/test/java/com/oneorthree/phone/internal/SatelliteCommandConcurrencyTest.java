package com.oneorthree.phone.internal;

import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;


import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * 동시 트랜잭션의 <b>경합</b> — 분리가 깨뜨리는 순서 불변식이 실제로 닫히는지 (A22 ⓚ · ㋕ · ㊸).
 *
 * <p>실물 PostgreSQL + 실제 Flyway 위에서 <b>두 커넥션</b>으로 돈다. 한 스레드 안에서 순서를 바꿔
 * 흉내 내면 잠금이 전혀 관여하지 않아, 정작 잠금이 빠져도 초록이 된다.
 */
@SpringBootTest
class SatelliteCommandConcurrencyTest {


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
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    @Test
    @DisplayName("같은 유저의 동시 설정 변경은 «서로 다른» version 을 받는다 — 시퀀스면 커밋 순서가 어긋난다")
    void concurrentSettingsCommandsGetDistinctOrderedVersions() throws Exception {
        UUID userId = newUser();
        int threads = 6;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Future<Long>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < threads; i++) {
                boolean enabled = i % 2 == 0;
                String key = "concurrent-" + i;
                futures.add(pool.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    return tx().execute(status -> userSatelliteCommandService
                            .recordNotificationSettings(userId, settings(enabled), key)
                            .version());
                }));
            }
            start.countDown();
            List<Long> versions = new java.util.ArrayList<>();
            for (Future<Long> future : futures) {
                versions.add(future.get(30, TimeUnit.SECONDS));
            }

            // aggregate 행 잠금 아래 발급되므로 중복이 없다. 시퀀스였다면 할당 순서만 보장돼
            // 「먼저 번호를 받고 늦게 커밋한 최신 상태」가 폐기된다(㊸).
            assertThat(versions).doesNotHaveDuplicates().hasSize(threads);
            assertThat(eventOutboxRepository.findAll().stream()
                    .filter(row -> row.getUserId().equals(userId))
                    .filter(row -> row.getType().equals("notification.settings.changed"))
                    .count()).isEqualTo(threads);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("명령이 롤백되면 봉투도 남지 않는다 — 「같은 트랜잭션」이라는 말의 뜻이 이것이다")
    void rollbackLeavesNoEnvelope() {
        UUID userId = newUser();
        // 설정 행을 지워 명령이 «도중에» 실패하게 만든다 — 실패 지점이 append 뒤여야 의미가 있다.
        tx().executeWithoutResult(status -> userNotificationSettingsRepository.deleteById(userId));

        assertThatThrownBy(() ->
                tx().execute(status -> userSatelliteCommandService
                        .recordNotificationSettings(userId, settings(true), "rollback-key")))
                .isInstanceOf(UserException.class);

        assertThat(eventOutboxRepository.findAll().stream()
                .anyMatch(row -> row.getUserId().equals(userId))).isFalse();
    }

    private static NotificationSettingsRequest settings(boolean enabled) {
        NotificationSettingsRequest request = new NotificationSettingsRequest();
        ReflectionTestUtils.setField(request, "notificationEnabled", enabled);
        ReflectionTestUtils.setField(request, "soundEnabled", true);
        ReflectionTestUtils.setField(request, "nightModeEnabled", false);
        return request;
    }

    private UUID newUser() {
        return tx().execute(status -> {
            User user = userRepository.save(User.builder().build());
            userNotificationSettingsRepository.save(
                    UserNotificationSettings.builder().userId(user.getId()).build());
            return user.getId();
        });
    }

}
