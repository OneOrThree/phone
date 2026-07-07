package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;

import java.util.List;

/**
 * 타 유저 통계 조회 응답 (GROMO-521).
 * 친구X + 대상 FRIENDS 공개: isFriend=false, today/heatmap=null (streak 만 반환).
 * 친구O·본인, 또는 대상 PUBLIC(전체공개): 전체 필드 채움 (PUBLIC 비친구는 isFriend=false 유지, GROMO-640).
 */
public record UserStatsResponse(
        boolean isFriend,
        StreakResponse streak,
        TodayStatsResponse today,
        List<HeatmapCellResponse> heatmap
) {
}
