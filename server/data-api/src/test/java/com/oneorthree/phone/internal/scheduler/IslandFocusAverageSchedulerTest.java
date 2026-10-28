package com.oneorthree.phone.internal.scheduler;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.IslandFocusAverageSnapshotService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.InOrder;
import org.slf4j.LoggerFactory;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.CannotSerializeTransactionException;
import org.springframework.dao.DeadlockLoserDataAccessException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;

import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 섬별 7일 평균 스케줄 트리거 (GROMO-2257) — 크론·존·락 이름은 애노테이션이 정본이라 선언을 단언하고,
 * 「어느 날짜를 넘기는가」는 고정 시계로, 「잠금 경합 재시도」는 서비스 대역으로 확인한다. 배치 본체와 실제 40P01 번역은
 * {@code IslandFocusAverageSnapshotIntegrationTest}.
 */
class IslandFocusAverageSchedulerTest {

    /** 2034-05-05 07:00:00 KST. UTC 날짜를 그대로 넘기면 2034-05-04 가 된다. */
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2034-05-04T22:00:00Z"), ZoneOffset.UTC);
    private static final LocalDate KST_DATE = LocalDate.of(2034, 5, 5);

    private final IslandFocusAverageSnapshotService service = mock(IslandFocusAverageSnapshotService.class);
    private final IslandFocusAverageScheduler scheduler = new IslandFocusAverageScheduler(service, CLOCK);
    private final Logger schedulerLog = (Logger) LoggerFactory.getLogger(IslandFocusAverageScheduler.class);
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @BeforeEach
    void captureLogs() {
        logs.start();
        schedulerLog.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        schedulerLog.detachAppender(logs);
        logs.stop();
    }

    static Stream<PessimisticLockingFailureException> lockFailures() {
        return Stream.of(
                new CannotAcquireLockException("교착 — Hibernate LockAcquisitionException 의 번역"),
                new DeadlockLoserDataAccessException("교착 — JDBC 경로의 번역", null),
                new CannotSerializeTransactionException("직렬화 실패"));
    }

    @Test
    @DisplayName("매일 07:00 KST 에 돌고 고유한 ShedLock 이름이 붙어 있다 — 존이 UTC 면 한낮(16:00 KST)에 돈다")
    void runsDailyAtSevenKstUnderALock() throws NoSuchMethodException {
        Method entry = IslandFocusAverageScheduler.class.getMethod("snapshotToday");

        Scheduled cron = entry.getAnnotation(Scheduled.class);
        assertThat(cron).as("@Scheduled 가 없으면 이 진입점은 운영에서 영영 안 돈다").isNotNull();
        assertThat(cron.cron()).isEqualTo("0 0 7 * * *");
        assertThat(cron.zone()).isEqualTo(ZonePolicy.KST_ID);

        SchedulerLock lock = entry.getAnnotation(SchedulerLock.class);
        assertThat(lock).as("멀티 인스턴스에서 같은 날을 동시에 적지 않게 락이 필요하다").isNotNull();
        assertThat(lock.name()).isEqualTo("island-focus-average-snapshot");
        assertThat(lock.lockAtMostFor()).isEqualTo("PT30M");
        assertThat(lock.lockAtLeastFor()).as("몇 초면 끝나는 잡이라 이게 없으면 시계가 어긋난 인스턴스가 한 번 더 돈다")
                .isEqualTo("PT1M");
    }

    @Test
    @DisplayName("서버 시계는 UTC 지만 넘기는 날짜는 «KST 로 환산한 오늘» 이다 — 07:00 KST 는 UTC 로는 전날 22시다")
    void passesTheKstDateNotTheUtcDate() {
        scheduler.snapshotToday();

        verify(service).snapshot(KST_DATE);
    }

    @Test
    @DisplayName("스냅샷이 끝나면 같은 KST 날짜로 오래된 행 정리를 부른다 — 스냅샷 «뒤» 에 (GROMO-2280)")
    void cleansUpAfterTheSnapshot() {
        scheduler.snapshotToday();

        InOrder order = inOrder(service);
        order.verify(service).snapshot(KST_DATE);
        order.verify(service).cleanup(KST_DATE);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("lockFailures")
    @DisplayName("잠금 경합(교착 등)으로 끊기면 한 번 다시 돌리고, 두 번째에 끝나면 예외 없이 마친다 — error 로그는 없다")
    void retriesOnceWhenTheSnapshotLosesALockRace(PessimisticLockingFailureException failure) {
        when(service.snapshot(KST_DATE)).thenThrow(failure).thenReturn(3);

        scheduler.snapshotToday();

        verify(service, times(2)).snapshot(KST_DATE);
        verify(service).cleanup(KST_DATE);
        assertThat(logs.list).filteredOn(event -> event.getLevel() == Level.WARN).singleElement()
                .satisfies(event -> assertThat(event.getFormattedMessage()).contains(KST_DATE.toString()));
        assertThat(logs.list).noneMatch(event -> event.getLevel() == Level.ERROR);
    }

    @Test
    @DisplayName("다시 돌려도 끊기면 더 돌리지 않는다 — KST 날짜와 함께 error 로그를 남기고 첫 실패를 붙인 그 예외를 던진다")
    void stopsAfterOneRetryAndLogsTheKstDate() {
        CannotAcquireLockException first = new CannotAcquireLockException("첫 교착");
        CannotAcquireLockException second = new CannotAcquireLockException("두 번째 교착");
        when(service.snapshot(KST_DATE)).thenThrow(first).thenThrow(second);

        assertThatThrownBy(scheduler::snapshotToday).isSameAs(second);

        verify(service, times(2)).snapshot(KST_DATE);
        verify(service, never()).cleanup(any());
        assertThat(second.getSuppressed()).as("첫 실패가 두 번째에 붙는다").containsExactly(first);
        assertThat(logs.list).filteredOn(event -> event.getLevel() == Level.ERROR).singleElement()
                .satisfies(event -> {
                    assertThat(event.getFormattedMessage()).contains(KST_DATE.toString());
                    assertThat(event.getThrowableProxy().getMessage()).isEqualTo("두 번째 교착");
                    assertThat(event.getThrowableProxy().getSuppressed()).as("error 로그 하나에 두 원인이 다 보인다")
                            .singleElement()
                            .satisfies(suppressed -> assertThat(suppressed.getMessage()).isEqualTo("첫 교착"));
                });
    }

    @Test
    @DisplayName("재시도에서 잠금 경합이 아닌 예외가 나도 error 로그를 남기고 그대로 던진다 — 세 번째 호출은 없다")
    void aNonLockFailureOnTheRetryIsLoggedAndRethrown() {
        CannotAcquireLockException first = new CannotAcquireLockException("교착");
        IllegalStateException boom = new IllegalStateException("재시도에서 터졌다");
        when(service.snapshot(KST_DATE)).thenThrow(first).thenThrow(boom);

        assertThatThrownBy(scheduler::snapshotToday).isSameAs(boom);

        verify(service, times(2)).snapshot(KST_DATE);
        assertThat(boom.getSuppressed()).as("첫 실패가 재시도의 예외에 붙는다").containsExactly(first);
        assertThat(logs.list).filteredOn(event -> event.getLevel() == Level.ERROR).singleElement()
                .satisfies(event -> assertThat(event.getFormattedMessage()).contains(KST_DATE.toString()));
    }

    @Test
    @DisplayName("두 시도가 같은 예외 인스턴스를 던져도 자기 자신을 붙이다 터지지 않는다 — 원래 예외가 그대로 나간다")
    void aSharedExceptionInstanceIsNotSuppressedIntoItself() {
        CannotAcquireLockException same = new CannotAcquireLockException("같은 인스턴스");
        when(service.snapshot(KST_DATE)).thenThrow(same);

        assertThatThrownBy(scheduler::snapshotToday).isSameAs(same);

        verify(service, times(2)).snapshot(KST_DATE);
        assertThat(same.getSuppressed()).isEmpty();
    }

    @Test
    @DisplayName("잠금 경합이 아닌 예외는 다시 시도하지 않고 종전처럼 그대로 던진다")
    void doesNotRetryOtherFailures() {
        IllegalStateException boom = new IllegalStateException("터졌다");
        when(service.snapshot(KST_DATE)).thenThrow(boom);

        assertThatThrownBy(scheduler::snapshotToday).isSameAs(boom);

        verify(service, times(1)).snapshot(KST_DATE);
        verify(service, never()).cleanup(any());
        assertThat(logs.list).noneMatch(event -> event.getLevel() == Level.ERROR);
    }
}
