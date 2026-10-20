package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.internal.repository.FocusFishPayoutQuery;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusTutorialRewardRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/** 날짜별 획득량 — UTC 상한 원장을 날짜째 옮기지 않고 실제 지급 건의 시각을 요청 창에 배분한다. */
@Service
@RequiredArgsConstructor
public class FocusFishEarningsReadService {
    private final FocusFishPayoutQuery earnings;
    private final FocusSessionIntervalRepository intervals;
    private final FocusTutorialRewardRepository tutorials;

    /** 개인 전체(섬 무관)의 확정 획득량. 호출측의 REPEATABLE READ 통계 스냅샷 안에서 읽는다. */
    public long earnedBetween(UUID userId, Instant from, Instant to, Instant asOf) {
        var grants = earnings.findGrantedRewards(userId, from, to);
        List<UUID> sessionIds = grants.stream().map(FocusFishPayoutQuery.GrantedReward::getSessionId)
                .distinct().toList();
        Map<UUID, List<FocusSessionInterval>> bySession = sessionIds.isEmpty() ? Map.of()
                : intervals.findBySessionIdInOrderByOrdinalAsc(sessionIds).stream()
                        .collect(Collectors.groupingBy(FocusSessionInterval::getSessionId));
        long total = earnings.sumGoldenFishBetween(userId, from, to);
        for (var grant : grants) {
            Instant at = grant.getCreditedAt();
            if (grant.getRewardNumber() != null && grant.getSecondsPerFish() != null) {
                at = FocusIntervalMath.instantAtActiveSeconds(
                        bySession.getOrDefault(grant.getSessionId(), List.of()), asOf,
                        Math.multiplyExact(grant.getRewardNumber(), grant.getSecondsPerFish().longValue()));
            }
            if (contains(from, to, at)) {
                total = Math.addExact(total, grant.getAmount());
            }
        }
        if (tutorials.findByUserId(userId).filter(r -> contains(from, to, r.getClaimedAt())).isPresent()) {
            total = Math.addExact(total, 1);
        }
        return total;
    }

    private static boolean contains(Instant from, Instant to, Instant at) {
        return at != null && !at.isBefore(from) && at.isBefore(to);
    }
}
