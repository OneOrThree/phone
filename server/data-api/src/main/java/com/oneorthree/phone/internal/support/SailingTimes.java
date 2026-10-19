package com.oneorthree.phone.internal.support;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬까지의 항해 시간 (GROMO-2260, 섬 외부 계약 §1) — {@code (사람, 섬, 1시간 버킷)} 하나에 고정된 분을 준다.
 *
 * <p>값은 {30, 60, 90} 셋 중 하나이고 고르게 나온다. 같은 입력이면 언제 다시 계산해도 같다 — 승인 편지의
 * 「N분 뒤 도착」과 망원경 말풍선(2265)이 같은 버킷 안에서 서로 다른 숫자를 말하면 안 된다. 섞기는
 * {@code GoldenFishDraw} 와 같은 splitmix64 finalizer 다(인접 씨앗이 비슷한 값으로 몰리지 않는다).
 */
public final class SailingTimes {

    private static final int[] MINUTES = {30, 60, 90};

    private static final long GAMMA = 0x9E3779B97F4A7C15L;
    private static final long MIX_A = 0xBF58476D1CE4E5B9L;
    private static final long MIX_B = 0x94D049BB133111EBL;

    private SailingTimes() {
    }

    /**
     * @param userId     항해하는 사람
     * @param islandId   목적지 섬
     * @param hourBucket 정시로 자른 시각({@code now.truncatedTo(HOURS)}) — 자르지 않으면 같은 시간대가 여러 값을 갖는다
     * @return 30·60·90 중 하나
     */
    public static int minutes(UUID userId, UUID islandId, Instant hourBucket) {
        long z = userId.getMostSignificantBits() * GAMMA
                + userId.getLeastSignificantBits() * MIX_A
                + islandId.getMostSignificantBits() * MIX_B
                + islandId.getLeastSignificantBits()
                + hourBucket.getEpochSecond() * GAMMA * MIX_A;
        z = (z ^ (z >>> 30)) * MIX_A;
        z = (z ^ (z >>> 27)) * MIX_B;
        z ^= z >>> 31;
        return MINUTES[(int) Math.floorMod(z, (long) MINUTES.length)];
    }
}
