package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.util.UUID;

/** {@code POST /internal/islands/{islandId}/quests/{questId}/claims} 요청 본문 (GROMO-1773, LLD §2). */
public record QuestClaimRequest(@NotNull UUID occurrenceId, @NotNull @Positive Long expectedVersion) {
}
