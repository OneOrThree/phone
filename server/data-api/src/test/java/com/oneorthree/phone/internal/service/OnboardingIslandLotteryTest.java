package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.internal.dto.TelescopeItemView;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class OnboardingIslandLotteryTest {
    private final OnboardingIslandService service = new OnboardingIslandService(
            null, null, null, null, null, null, null, null, null);

    @Test
    void destinationIsAlwaysShownBelowMembershipLimitAndStableWithinBucket() {
        UUID user = UUID.fromString("00000000-0000-0000-0000-000000000001");
        List<UUID> memberships = List.of(
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                UUID.fromString("00000000-0000-0000-0000-000000000003"));
        var normalIsland = new TelescopeItemView(
                UUID.fromString("00000000-0000-0000-0000-000000000004"), "가입 가능한 섬", "", 1, 15,
                false, "active", "nearby", 15, null, false, false, null, null, null, 0);
        Instant start = Instant.parse("2026-10-27T12:00:00Z");
        for (int joinedCount = 0; joinedCount <= 2; joinedCount++) {
            List<UUID> joined = memberships.subList(0, joinedCount);
            for (int hour = 0; hour < 200; hour++) {
                Instant bucket = start.plusSeconds(hour * 3600L);
                var empty = service.destination(user, joined, List.of(), bucket);
                var withNormalIsland = service.destination(user, joined, List.of(normalIsland), bucket);
                assertThat(empty).isPresent().isEqualTo(withNormalIsland);
                assertThat(service.destination(user, joined, List.of(normalIsland), bucket))
                        .isEqualTo(withNormalIsland);
            }
        }
    }

    @Test
    void destinationIsHiddenAtOrAboveMembershipLimit() {
        UUID user = UUID.randomUUID();
        Instant bucket = Instant.parse("2026-10-27T12:00:00Z");
        List<UUID> memberships = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        assertThat(service.destination(user, memberships.subList(0, 3), List.of(), bucket)).isEmpty();
        assertThat(service.destination(user, memberships, List.of(), bucket)).isEmpty();
    }
}
