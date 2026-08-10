package com.oneorthree.phone.common.config;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.scheduler.GroupBetScheduler;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.SimpleLock;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

import javax.sql.DataSource;

import java.lang.reflect.Method;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

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

    @Autowired
    ApplicationContext applicationContext;

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
    @DisplayName("정산 계열 크론은 전용 스케줄러에서 돈다 — 알림 팬아웃이 돈 처리를 잠식하지 못한다")
    void settlementCronsRunOnDedicatedScheduler() {
        int settlementCrons = 0;
        for (Method method : GroupBetScheduler.class.getDeclaredMethods()) {
            Scheduled[] schedules = method.getAnnotationsByType(Scheduled.class);
            if (schedules.length == 0) {
                continue;
            }
            settlementCrons++;
            for (Scheduled schedule : schedules) {
                assertThat(schedule.scheduler())
                        .as("%s 가 공용 풀에서 돈다 — 알림 팬아웃이 슬롯을 선점하면 정산·환불이 밀린다",
                                method.getName())
                        .isEqualTo(SchedulingConfig.SETTLEMENT_SCHEDULER);
            }
        }
        assertThat(settlementCrons).isEqualTo(3);

        // 두 풀은 서로 다른 빈이어야 격리가 성립한다(같은 빈이면 이름만 다른 공용 풀이다).
        assertThat(applicationContext.getBean(SchedulingConfig.SETTLEMENT_SCHEDULER))
                .isNotSameAs(applicationContext.getBean("taskScheduler"));
        // 알림 크론은 반대로 공용 풀을 쓴다(전용 풀을 잠식하지 않는다).
        for (Method method : com.oneorthree.phone.notification.scheduler.NotificationScheduler.class
                .getDeclaredMethods()) {
            for (Scheduled schedule : method.getAnnotationsByType(Scheduled.class)) {
                assertThat(schedule.scheduler())
                        .as("알림 크론 %s 가 정산 전용 풀을 쓰면 격리가 무의미해진다", method.getName())
                        .isNotEqualTo(SchedulingConfig.SETTLEMENT_SCHEDULER);
            }
        }
    }

    /**
     * <b>애플리케이션 전체</b>의 {@code @Scheduled} 를 훑는다 — 스케줄러 클래스를 열거하면 새로
     * 추가된 크론이 검사 밖에 남는다(실제로 리그·orphan 스케줄러가 그렇게 빠져 있었다).
     * 컨텍스트의 모든 빈을 대상으로 하므로 앞으로 어디에 크론을 추가해도 여기서 걸린다.
     */
    @Test
    @DisplayName("애플리케이션의 모든 @Scheduled 에 고유 이름의 @SchedulerLock 이 걸려 있다")
    void everyCronEntryPointIsLocked() {
        Map<String, String> ownerByLockName = new HashMap<>();
        int scheduled = 0;
        for (String beanName : applicationContext.getBeanDefinitionNames()) {
            Class<?> beanType = applicationContext.getType(beanName);
            if (beanType == null || !beanType.getName().startsWith("com.oneorthree.phone")) {
                continue;
            }
            Class<?> targetType = AopUtils.getTargetClass(applicationContext.getBean(beanName));
            for (Method method : targetType.getDeclaredMethods()) {
                if (method.getAnnotationsByType(Scheduled.class).length == 0) {
                    continue;
                }
                scheduled++;
                String owner = targetType.getSimpleName() + "." + method.getName();
                SchedulerLock lock = method.getAnnotation(SchedulerLock.class);
                assertThat(lock)
                        .as("%s 은 @Scheduled 인데 @SchedulerLock 이 없다 — 멀티 인스턴스에서 중복 실행된다",
                                owner)
                        .isNotNull();
                String previous = ownerByLockName.put(lock.name(), owner);
                assertThat(previous)
                        .as("락 이름 중복(%s): %s ↔ %s — 서로 다른 크론이 같은 락을 다투면 한쪽이 굶는다",
                                lock.name(), previous, owner)
                        .isNull();
            }
        }
        // 스케줄러가 통째로 사라지면(=탐색 실패) 검사가 공회전한다 — 하한을 둔다.
        assertThat(scheduled).isGreaterThanOrEqualTo(15);
        assertThat(ownerByLockName).containsKeys("league-weekly-batch", "focus-orphan-sweep",
                "group-bet-settle-scan", "notification-bet-event-flush");
    }
}
