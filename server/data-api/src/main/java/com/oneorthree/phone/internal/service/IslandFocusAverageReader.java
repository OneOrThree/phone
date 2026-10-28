package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.ranking.repository.IslandFocusAverageRepository;
import com.oneorthree.phone.ranking.repository.domain.IslandFocusAverage;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.OptionalInt;
import java.util.UUID;

/**
 * 섬별 7일 평균의 <b>읽기 창구</b> (GROMO-2257) — 망원경 목록(GROMO-2265)이 항목마다
 * {@code averageFocusMinutesPerDay} 를 채울 때 부른다. 이 클래스가 끝이다: 이 티켓은 공개 필드를 내지 않는다.
 *
 * <p>값은 매일 07:00 KST 배치({@link IslandFocusAverageSnapshotService})가 적은 <b>가장 최근 snapshot_date 행</b>
 * 이다. 같은 날 안에서는 몇 번을 읽어도 같은 행이라 값이 같다.
 */
@Service
@RequiredArgsConstructor
public class IslandFocusAverageReader {

    private final IslandFocusAverageRepository snapshots;

    /**
     * 섬마다 가장 최근 스냅샷의 하루 평균(분).
     *
     * <p><b>요청한 섬 전부가 키로 들어 있다</b> — 호출자가 {@code get(id)} 를 널 검사 없이 쓸 수 있다. 값이
     * {@link OptionalInt#empty()} 이면 호출자는 {@code null} 로 낸다. 비는 경우는 둘이다:
     * <ul>
     *   <li>한 번도 집계되지 않았다(막 생긴 섬, 아직 07시 배치가 돌지 않았다).</li>
     *   <li>가장 최근 행의 주민 수가 0명이라 평균이 null 이다. <b>옛 행의 값으로 되돌아가지 않는다.</b></li>
     * </ul>
     * 주민이 있는데 집중이 없었다면 비지 않고 {@code 0} 이다.
     *
     * @param islandIds 조회할 섬 id. 비어 있으면 빈 맵이다
     * @return 섬 id → 하루 평균(분). 요청한 id 와 키 집합이 같다
     */
    @Transactional(readOnly = true)
    public Map<UUID, OptionalInt> latest(Collection<UUID> islandIds) {
        Map<UUID, OptionalInt> result = new HashMap<>();
        if (islandIds.isEmpty()) {
            return result;
        }
        islandIds.forEach(id -> result.put(id, OptionalInt.empty()));
        for (IslandFocusAverage row : snapshots.findLatestByIslandIds(islandIds)) {
            Integer average = row.getAvgMinutesPerMemberDay();
            if (average != null) {
                result.put(row.getIslandId(), OptionalInt.of(average));
            }
        }
        return result;
    }
}
