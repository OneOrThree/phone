package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.IslandFocusAverageSnapshotService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;

/**
 * 섬별 «최근 7일 주민 1명당 하루 평균 집중» 스냅샷의 스케줄 트리거 (GROMO-2257).
 *
 * <p>매일 07:00 <b>KST</b> 에 돈다 — 07:00 KST 는 전날 22:00 UTC 라 서버 {@link Clock}(UTC)의 «오늘» 이 아니라
 * <b>KST 로 환산한 오늘</b> 을 넘겨야 한다. UTC 날짜를 그대로 넘기면 창이 하루 어긋난다. 배치 로직은
 * {@link IslandFocusAverageSnapshotService} 에 있고 테스트는 크론 없이 그것만 부른다
 * ({@code IslandRankingFreezeScheduler} 와 같은 구성).
 *
 * <p>분산 락은 인스턴스가 둘일 때 같은 날을 동시에 적는 중복 작업을 줄이려고 건다. 정합성의 방어선은 락이 아니라
 * {@code (snapshot_date, island_id)} PK 와 {@code ON CONFLICT DO NOTHING} 이다 — 락을 놓쳐도 첫 값이 남는다.
 * {@code lockAtLeastFor} 1분은 인스턴스 사이 시계 어긋남으로 같은 07:00 틱이 다른 인스턴스에 늦게 닿아, 몇 초면 끝나
 * 일찍 풀린 락을 잡고 한 번 더 도는 것을 막는다.
 *
 * <p><b>잠금 경합으로 끊기면 한 번만 다시 돌린다.</b> 적는 문장이 살아 있는 섬 행을 {@code FOR SHARE} 로 잠그므로 섬 행을
 * 다른 순서로 잠그는 쪽(계정 탈퇴 등)과 겹치면 PostgreSQL 이 이쪽을 교착 희생자로 끊을 수 있다. 서비스 트랜잭션은 통째로
 * 롤백되고 {@code ON CONFLICT} 라 같은 날을 다시 돌려도 안전하다. 교착(40P01)은 Hibernate {@code LockAcquisitionException}
 * → Spring {@code CannotAcquireLockException} 으로 번역되고 JDBC 경로는 {@code DeadlockLoserDataAccessException} 이 되므로,
 * 둘의 상위인 {@link PessimisticLockingFailureException} 을 잡는다. 두 번째도 끊기면 첫 실패를 suppressed 로 붙여 error
 * 로그 하나(KST 날짜 포함)에 두 원인이 다 보이게 하고 그 예외를 그대로 던진다(그날 행은 없고 읽는 쪽은 전날 값을 준다).
 * 다른 예외는 다시 시도하지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IslandFocusAverageScheduler {

    private final IslandFocusAverageSnapshotService snapshots;
    private final Clock clock;

    @Scheduled(cron = "0 0 7 * * *", zone = ZonePolicy.KST_ID)
    @SchedulerLock(name = "island-focus-average-snapshot", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void snapshotToday() {
        LocalDate today = LocalDate.now(clock.withZone(ZonePolicy.KST));
        log.info("섬별 7일 평균 집계 스케줄 트리거 date={}", today);
        try {
            snapshots.snapshot(today);
        } catch (PessimisticLockingFailureException lockFailure) {
            log.warn("섬별 7일 평균 집계가 잠금 경합으로 끊겨 한 번 다시 시도한다 date={}", today, lockFailure);
            retryOnce(today, lockFailure);
        }
    }

    private void retryOnce(LocalDate today, RuntimeException firstFailure) {
        try {
            snapshots.snapshot(today);
        } catch (RuntimeException failure) {
            // error 로그 하나에 두 원인이 보이게 첫 실패를 붙인다. 같은 인스턴스는 addSuppressed 가 거부한다.
            if (failure != firstFailure) {
                failure.addSuppressed(firstFailure);
            }
            log.error("섬별 7일 평균 집계 재시도도 실패 — 그날 행이 없다 date={}", today, failure);
            throw failure;
        }
    }
}
