package com.oneorthree.phone.internal.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SailingTimesTest {

    private static final Instant BUCKET = Instant.parse("2026-10-12T03:00:00Z");

    @Test
    @DisplayName("같은 (사람, 섬, 버킷)은 언제 계산해도 같은 분이다")
    void sameInputSameMinutes() {
        UUID user = UUID.randomUUID();
        UUID island = UUID.randomUUID();
        int first = SailingTimes.minutes(user, island, BUCKET);
        for (int i = 0; i < 100; i++) {
            assertThat(SailingTimes.minutes(user, island, BUCKET)).isEqualTo(first);
        }
    }

    @Test
    @DisplayName("30·60·90 세 값만 나오고 셋이 고르게 나온다")
    void onlyThreeValuesRoughlyUniform() {
        Map<Integer, Integer> counts = new HashMap<>();
        for (long i = 0; i < 3000; i++) {
            counts.merge(SailingTimes.minutes(new UUID(i, i * 31), new UUID(i * 7, i), BUCKET), 1, Integer::sum);
        }
        assertThat(counts.keySet()).containsExactlyInAnyOrder(30, 60, 90);
        counts.values().forEach(count -> assertThat(count).isBetween(850, 1150));
    }

    @Test
    @DisplayName("버킷이 바뀌면 같은 사람·섬의 값 분포가 바뀐다")
    void bucketChangesTheDraw() {
        Instant next = BUCKET.plus(1, ChronoUnit.HOURS);
        List<Boolean> changed = new ArrayList<>();
        for (long i = 0; i < 300; i++) {
            UUID user = new UUID(i, 17);
            UUID island = new UUID(5, i);
            changed.add(SailingTimes.minutes(user, island, BUCKET) != SailingTimes.minutes(user, island, next));
        }
        // 독립이면 약 2/3 가 바뀐다 — 대부분 그대로면 버킷이 섞이지 않은 것이다.
        assertThat(changed.stream().filter(Boolean::booleanValue).count()).isBetween(150L, 250L);
    }
}
