package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.IslandFocusAverageSnapshotService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
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
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IslandFocusAverageScheduler {

    private final IslandFocusAverageSnapshotService snapshots;
    private final Clock clock;

    @Scheduled(cron = "0 0 7 * * *", zone = ZonePolicy.KST_ID)
    @SchedulerLock(name = "island-focus-average-snapshot", lockAtMostFor = "PT30M")
    public void snapshotToday() {
        LocalDate today = LocalDate.now(clock.withZone(ZonePolicy.KST));
        log.info("섬별 7일 평균 집계 스케줄 트리거 date={}", today);
        snapshots.snapshot(today);
    }
}
