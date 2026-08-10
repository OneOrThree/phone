package com.oneorthree.phone.common.config;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.scheduler.GroupBetScheduler;
import com.oneorthree.phone.notification.scheduler.NotificationScheduler;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.SimpleLock;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

import javax.sql.DataSource;

import java.lang.reflect.Method;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ShedLock 배선(GROMO-1283, policy §E4)의 통합 검증 — 잠그는 성질 둘:
 * ① V45 {@code shedlock} 테이블 위에서 락 선점이 실제로 배타적이다(두 번째 획득 실패 = 다른
 * 인스턴스의 중복 실행 차단), ② 챌린지·정산·알림 크론 진입점 전부에 {@code @SchedulerLock} 이
 * 고유 이름으로 걸려 있다 — 애노테이션이 빠진 크론은 락 없이 모든 인스턴스에서 돈다.
 */
class ShedLockIntegrationTest extends IntegrationTestBase {

    @Autowired
    LockProvider lockProvider;

    @Autowired
    DataSource dataSource;

    @BeforeEach
    void createShedlockTable() {
        // ci 프로파일은 Flyway OFF + 엔티티 기반 create-drop 이라(GROMO-670) 엔티티 없는 shedlock
        // 테이블이 스키마에 없다 — V45 과 같은 DDL 을 여기서 깐다(실 마이그레이션 SQL 은
        // NotificationSentLogV45MigrationTest 가 검증).
        new JdbcTemplate(dataSource).execute("CREATE TABLE IF NOT EXISTS shedlock ("
                + "name varchar(64) NOT NULL, lock_until timestamp NOT NULL, "
                + "locked_at timestamp NOT NULL, locked_by varchar(255) NOT NULL, "
                + "CONSTRAINT shedlock_pkey PRIMARY KEY (name))");
    }

    @Test
    @DisplayName("같은 이름의 락은 동시에 하나만 잡힌다 — 해제 후에야 재획득된다")
    void lockIsExclusiveUntilReleased() {
        LockConfiguration config = new LockConfiguration(Instant.now(),
                "shedlock-integration-test", Duration.ofMinutes(10), Duration.ZERO);

        Optional<SimpleLock> first = lockProvider.lock(config);
        assertThat(first).isPresent();

        // 다른 인스턴스의 같은 크론 — 락이 살아 있는 동안은 실행권을 얻지 못한다.
        assertThat(lockProvider.lock(config)).isEmpty();

        first.get().unlock();
        Optional<SimpleLock> reacquired = lockProvider.lock(new LockConfiguration(Instant.now(),
                "shedlock-integration-test", Duration.ofMinutes(10), Duration.ZERO));
        assertThat(reacquired).isPresent();
        reacquired.get().unlock();
    }

    @Test
    @DisplayName("챌린지·정산·알림 크론 전부에 @SchedulerLock 이 고유 이름으로 걸려 있다")
    void everyCronEntryPointIsLocked() {
        Set<String> names = new HashSet<>();
        for (Class<?> scheduler : new Class<?>[] {GroupBetScheduler.class, NotificationScheduler.class}) {
            for (Method method : scheduler.getDeclaredMethods()) {
                if (method.getAnnotationsByType(Scheduled.class).length == 0) {
                    continue;
                }
                SchedulerLock lock = method.getAnnotation(SchedulerLock.class);
                assertThat(lock)
                        .as("%s.%s 은 @Scheduled 인데 @SchedulerLock 이 없다 — 멀티 인스턴스에서 중복 실행된다",
                                scheduler.getSimpleName(), method.getName())
                        .isNotNull();
                assertThat(names.add(lock.name()))
                        .as("락 이름 중복: %s — 서로 다른 크론이 같은 락을 다투면 한쪽이 조용히 굶는다",
                                lock.name())
                        .isTrue();
            }
        }
        assertThat(names).isNotEmpty();
    }
}
