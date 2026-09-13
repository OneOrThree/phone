package com.oneorthree.phone.internal.notification.service;

import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.notification.producer.NotificationKind;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.UUID;

/** LeagueNotificationService의 강등 위험 우선 → 승급 독려 분기를 현재 정본으로 다시 판정한다. */
@Component
@RequiredArgsConstructor
public class NotificationLeagueEligibility {
    private final LeagueRankingQueryRepository rankings;
    private final LeagueTierConfigRepository tiers;
    private final LeagueWeek week;

    /** 공통 수신자·만료 검사를 통과한 리그 위기 3종만 들어온다. 관리자 시험도 같은 조건을 따른다. */
    public NotificationEligibilityResponse evaluate(NotificationKind kind, UUID userId, Instant now) {
        LeagueRankingRow row = rankings.findWeeklyTotalForUser(userId,
                week.currentWeekStartDate(now), week.currentDate(now)).orElse(null);
        if (row == null) {
            return NotificationEligibilityResponse.deny("LEAGUE_CONDITION_CHANGED");
        }
        LeagueTierConfig config = tiers.findById(row.tierLevel())
                .filter(tier -> tier.getDeletedAt() == null)
                .orElseThrow(() -> new IllegalStateException("현재 리그 티어 설정이 없습니다"));
        boolean relegation = row.tierLevel() > 1 && row.totalFocusSeconds() < config.getRelegationTime();
        boolean eligible = switch (kind) {
            case LEAGUE_RELEGATION_WARNING, LEAGUE_RELEGATION_WARNING_EVENING -> relegation;
            case LEAGUE_DEADLINE_D1 -> !relegation && row.tierLevel() < 5
                    && row.totalFocusSeconds() < config.getPromotionTime();
            default -> throw new IllegalArgumentException("리그 위기 알림 종류가 아닙니다");
        };
        return eligible ? NotificationEligibilityResponse.allow()
                : NotificationEligibilityResponse.deny("LEAGUE_CONDITION_CHANGED");
    }
}
