package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;

import java.util.List;

/**
 * 타 유저 통계 조회 응답 (GROMO-521).
 * 친구X: isFriend=false, today/heatmap=null (streak 만 반환).
 * 친구O 또는 본인 조회: 전체 필드 채움.
 */
public record UserStatsResponse(
        boolean isFriend,
        StreakResponse streak,
        TodayStatsResponse today,
        List<HeatmapCellResponse> heatmap
) {
}
