package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;

import java.util.List;

/**
 * 타 유저 통계 조회 응답 (GROMO-521).
 * 프로필 요약(streak·today)은 친구 여부/공개설정과 무관하게 항상 채움 (GROMO-746).
 * 세부 차트(heatmap)만 공개 게이트: 친구O·본인, 또는 대상 PUBLIC 이면 채움, 그 외 null
 * (PUBLIC 비친구는 isFriend=false 유지, GROMO-640).
 */
public record UserStatsResponse(
        boolean isFriend,
        StreakResponse streak,
        TodayStatsResponse today,
        List<HeatmapCellResponse> heatmap
) {
}
