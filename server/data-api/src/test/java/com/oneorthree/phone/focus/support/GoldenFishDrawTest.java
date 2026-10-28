package com.oneorthree.phone.focus.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 황금 물고기 주사위 (GROMO-1956) — 「재추첨 금지」가 이 클래스의 결정성에 걸려 있다.
 *
 * <p>겨냥하는 실패: 크론이 밀리거나 ShedLock 을 놓쳐 같은 분을 다시 돌릴 때, 결과가 매번 다르면 그
 * 재시도가 그대로 재추첨이 되어 확률이 소리 없이 올라간다.
 */
class GoldenFishDrawTest {

    private static final Instant MINUTE = Instant.parse("2031-03-10T10:00:00Z");

    @Test
    @DisplayName("같은 (섬, 분) 은 몇 번을 돌려도 같은 값이다 — 재추첨이 없다")
    void sameIslandAndMinuteAlwaysRollsTheSame() {
        UUID island = UUID.fromString("0f3b7b52-8a1f-4a77-9d3d-9b0d4b1d2c11");
        int first = GoldenFishDraw.roll(island, MINUTE);
        for (int i = 0; i < 100; i++) {
            assertThat(GoldenFishDraw.roll(island, MINUTE)).isEqualTo(first);
        }
        assertThat(first).isBetween(0, GoldenFishDraw.SCALE - 1);
    }

    @Test
    @DisplayName("이웃한 분·다른 섬은 값이 흩어진다 — 인접 씨앗이 몰리면 확률이 섬·시간대마다 비뚤어진다")
    void adjacentSeedsDoNotCluster() {
        UUID island = UUID.fromString("0f3b7b52-8a1f-4a77-9d3d-9b0d4b1d2c11");
        // 연속한 60분이 «전부» 같은 10분의 1 구간에 몰리면 안 된다.
        int[] buckets = new int[10];
        for (int i = 0; i < 60; i++) {
            buckets[GoldenFishDraw.roll(island, MINUTE.plus(i, ChronoUnit.MINUTES)) / 100_000]++;
        }
        assertThat(Arrays.stream(buckets).max().orElseThrow()).isLessThanOrEqualTo(20);

        // 4% 임계(40_000ppm)를 넘는 비율이 이론값(4%) 언저리여야 한다 — 편향이면 보상 총량이 통째로 틀어진다.
        int wins = 0;
        int trials = 200_000;
        for (int i = 0; i < trials; i++) {
            if (GoldenFishDraw.roll(new UUID(i, i * 31L), MINUTE) < 40_000) {
                wins++;
            }
        }
        assertThat((double) wins / trials).isBetween(0.03, 0.05);
    }
}
