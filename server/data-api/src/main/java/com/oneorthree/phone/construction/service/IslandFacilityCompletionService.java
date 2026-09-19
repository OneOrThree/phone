package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.common.port.IslandAppearancePort;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.FacilityStatus;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.group.service.IslandStateEvents;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * 건설 완공의 내구 전이 — 스케줄러가 {@code completesAt} 경과를 쓸어 온 BUILDING 행을
 * <b>건별 트랜잭션</b>으로 COMPLETED 로 전이하고 {@code island.updated} 를 발행한다.
 *
 * <p>{@code IslandConstructionService} 와 다른 빈이다 — 스케줄러가 행마다 이 메서드를 부르므로
 * 한 시설의 전이 실패가 다른 시설을 말아먹지 않는다(건별 격리). 전이는 멱등하다 — 같은 행을
 * 두 번 쓸어도 두 번째는 status 가 이미 COMPLETED 라 아무 일도 하지 않는다.
 */
@Service
@RequiredArgsConstructor
public class IslandFacilityCompletionService {

    private final IslandFacilityRepository facilities;
    private final IslandStateEvents islandStateEvents;
    private final IslandAppearancePort islandAppearance;
    private final Clock clock;

    /**
     * 한 시설의 완공을 확정한다.
     *
     * @return 전이가 일어났으면 {@code true} — 이미 완공됐거나 아직 공사 중이면 {@code false}
     */
    @Transactional
    public boolean completeOne(UUID islandId, String buildingId) {
        Instant now = clock.instant();
        IslandFacility facility = facilities.findByIdForCompletionUpdate(islandId, buildingId)
                .orElse(null);
        if (facility == null || facility.getStatus() != FacilityStatus.BUILDING
                || facility.getCompletesAt().isAfter(now)) {
            return false;
        }
        facility.complete(now);
        // 시설 완공은 island.updated — 실제 공동 차감의 wallet.updated 는 착공 TX 가 이미 냈다.
        islandStateEvents.changed(islandId, facility.getStartedBy(), "FACILITY_COMPLETED");
        // 완공된 건물은 공동 외양 대상이다 — 같은 TX 에 default 로 시드해 「완공됐는데 테마를
        // 못 받는 창」을 없앤다(GROMO-1783). 멱등 — 이미 키가 있으면 아무 일도 하지 않는다.
        islandAppearance.buildingCompleted(islandId, buildingId, facility.getStartedBy());
        return true;
    }
}
