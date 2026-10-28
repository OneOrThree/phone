package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** {@code PATCH /internal/islands/{islandId}/join-requests/{requestId}} 본문 (GROMO-1802, 섬 관리 LLD §3.4). */
public record JoinRequestAnswerCommandRequest(@NotNull @Pattern(regexp = "approve|reject") String decision) {

    public boolean approve() {
        return "approve".equals(decision);
    }
}
