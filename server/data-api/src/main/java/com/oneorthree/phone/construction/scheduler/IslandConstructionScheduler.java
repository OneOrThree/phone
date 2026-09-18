package com.oneorthree.phone.construction.scheduler;

import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.service.IslandFacilityCompletionService;
import com.oneorthree.phone.config.SchedulingConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * 건설 완공 스윕 (GROMO-1767) — {@code completesAt} 가 지난 BUILDING 행을 쓸어 COMPLETED 로
 * 전이한다. 기존 {@code GroupBetScheduler} 와 같은 @Scheduled + @SchedulerLock 패턴이다.
 *
 * <p>이 클래스 자체는 <b>의도적으로 무트랜잭션</b>이다 — 행마다
 * {@link IslandFacilityCompletionService#completeOne} 이 자기 트랜잭션으로 돌아 한 시설의
 * 실패가 다른 시설을 말아먹지 않는다(건별 격리). ShedLock 은 멀티 인스턴스 중복 스캔 차단용이고,
 * 락을 놓쳐도 시설 행 잠금 + 상태 가드가 이중 전이를 막는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IslandConstructionScheduler {

    private final IslandFacilityRepository facilities;
    private final IslandFacilityCompletionService completion;

    /**
     * 1분 주기 완공 스캔 — 가장 짧은 공사 시간이 1분(회관)이라 그보다 긴 주기는 완공을 늦춘다.
     */
    @Scheduled(cron = "0 * * * * *", zone = "Asia/Seoul",
            scheduler = SchedulingConfig.SETTLEMENT_SCHEDULER)
    @SchedulerLock(name = "island-construction-completion-sweep")
    public void completeDueFacilities() {
        List<IslandFacility> due = facilities.findDueForCompletion(Instant.now());
        for (IslandFacility facility : due) {
            try {
                completion.completeOne(facility.getIslandId(), facility.getBuildingId());
            } catch (RuntimeException e) {
                // 실패는 건별 격리 — 다음 틱이 같은 행을 다시 집는다(전이는 멱등).
                log.error("시설 완공 전이 실패 — 다음 틱에 재시도. islandId={}, buildingId={}",
                        facility.getIslandId(), facility.getBuildingId(), e);
            }
        }
    }
}
