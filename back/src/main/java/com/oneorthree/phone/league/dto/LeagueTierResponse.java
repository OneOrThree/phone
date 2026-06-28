package com.oneorthree.phone.league.dto;

import java.time.Instant;
import java.util.UUID;

public record LeagueTierResponse(
        boolean assigned,
        Integer tierLevel,
        UUID arenaId,
        Instant weekStartAt,
        String status,
        String badgeId
) {
}
