package com.oneorthree.phone.internal.notification.service;

import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
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

/** LeagueNotificationService의 강등 위험 우선 → 승급 독려 분기를 현재 정본으로 다시 판정한다. */
@Component
@RequiredArgsConstructor
public class NotificationLeagueEligibility {
    private final LeagueRankingQueryRepository rankings;
    private final LeagueTierConfigRepository tiers;
    private final LeagueWeek week;

    /** 공통 수신자·만료 검사를 통과한 리그 위기 3종만 들어온다. 관리자 시험도 같은 조건을 따른다. */
    public NotificationEligibilityResponse evaluate(NotificationKind kind, NotificationEligibilityRequest request,
            Instant now) {
        LeagueRankingRow row = rankings.findWeeklyTotalForUser(request.userId(),
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
        if (!eligible) {
            return NotificationEligibilityResponse.deny("LEAGUE_CONDITION_CHANGED");
        }
        // 사건의 원래 렌더 입력은 고치지 않는다. 아직 위기여도 부족 시간이 바뀌었으면 옛 문구를 버린다.
        // params가 비어 있는 관리자 시험 등에는 새 필수 입력을 추가하지 않는다.
        if (request.params().containsKey("shortfallSeconds")) {
            int threshold = kind == NotificationKind.LEAGUE_DEADLINE_D1
                    ? config.getPromotionTime() : config.getRelegationTime();
            long currentShortfall = (long) threshold - row.totalFocusSeconds();
            Object original = request.params().get("shortfallSeconds");
            if (!(original instanceof Number seconds) || seconds.doubleValue() != currentShortfall) {
                return NotificationEligibilityResponse.deny("LEAGUE_CONDITION_CHANGED");
            }
        }
        return NotificationEligibilityResponse.allow();
    }
}
