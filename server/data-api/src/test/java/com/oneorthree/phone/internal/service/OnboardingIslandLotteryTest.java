package com.oneorthree.phone.internal.service;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class OnboardingIslandLotteryTest {
    private final OnboardingIslandService service = new OnboardingIslandService(
            null, null, null, null, null, null, null, null);

    @Test
    void memberLotteryIsIndependentOfNormalListAndStableWithinBucket() {
        UUID user = UUID.randomUUID();
        UUID joined = UUID.randomUUID();
        Instant start = Instant.parse("2026-10-27T12:00:00Z");
        int shown = 0;
        for (int hour = 0; hour < 200; hour++) {
            Instant bucket = start.plusSeconds(hour * 3600L);
            var empty = service.destination(user, List.of(joined), List.of(), bucket);
            var withNormalIsland = service.destination(user, List.of(joined), List.of(
                    new com.oneorthree.phone.internal.dto.TelescopeItemView(joined, "기존 섬", "", 1, 15,
                            false, "active", "joined", 30, null, false, true, null, null, null, 0)), bucket);
            assertThat(empty).isEqualTo(withNormalIsland);
            shown += empty.isPresent() ? 1 : 0;
        }
        assertThat(shown).isBetween(20, 60);
        assertThat(service.destination(user, List.of(joined, UUID.randomUUID(), UUID.randomUUID()),
                List.of(), start)).isEmpty();
    }

    @Test
    void firstSettlementWithoutJoinableIslandIsGuaranteed() {
        UUID user = UUID.randomUUID();
        Instant bucket = Instant.parse("2026-10-27T12:00:00Z");
        assertThat(service.destination(user, List.of(), List.of(), bucket)).isPresent();
    }
}
