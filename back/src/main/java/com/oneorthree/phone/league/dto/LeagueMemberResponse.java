package com.oneorthree.phone.league.dto;

import java.util.UUID;

public record LeagueMemberResponse(
        int rank,
        UUID userId,
        String nickname,
        int totalFocusMinutes,
        String result
) {
}
