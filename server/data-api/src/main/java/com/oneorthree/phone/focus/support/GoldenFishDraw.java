package com.oneorthree.phone.focus.support;

import java.time.Instant;
import java.util.UUID;

/**
 * 황금 물고기 추첨의 주사위 (GROMO-1956) — {@code (섬, 분)} 하나에 <b>고정된</b> 값을 돌려준다.
 *
 * <h2>왜 난수 생성기가 아닌가 — 재추첨 금지</h2>
 * 「섬마다 1분에 한 번 추첨한다」(기획 정본)를 지키려면 <b>같은 분을 두 번 돌려도 결과가 같아야</b> 한다.
 * 크론은 인스턴스가 여럿이고 ShedLock 을 놓칠 수도 있으며, 실패한 틱은 다음 틱이 다시 집는다. 난수를
 * 뽑는 구현이면 그 재시도가 그대로 «재추첨» 이 되어 확률이 소리 없이 올라간다 — 진 결과를 기록해 두는
 * 표를 하나 더 두는 길도 있지만, 진 추첨이 이기는 추첨의 250배라 그 표가 전부 쓰레기다.
 *
 * <p>그래서 씨앗을 {@code (섬, 분)} 으로 고정하고 순수 함수로 섞는다. 이기는 추첨의 «중복 지급» 은 이
 * 결정성만으로는 막히지 않는다 — 그쪽은 섬 원장의 멱등 키({@code golden:<분>})와
 * {@code uq_island_wallet_tx_idem} 이 막는다.
 *
 * <p>섞기는 splitmix64 의 finalizer 다. 이웃한 분·이웃한 섬 id 가 비슷한 값으로 몰리지 않아야 해서
 * ({@code Objects.hash} 나 LCG 한 스텝으로는 인접 씨앗이 상관된다) 고정 상수 세 번의 곱·xor-shift 를 쓴다.
 * JDK 판올림에 흔들리지 않는 것도 필요 조건이다 — {@code Random} 의 «명세된» 수열에 기대는 대신
 * 산술을 여기 적어 둔다.
 */
public final class GoldenFishDraw {

    /** 확률 단위 — {@link #roll} 은 {@code [0, SCALE)} 이고 확률표는 ppm 이다. */
    public static final int SCALE = 1_000_000;

    private static final long GAMMA = 0x9E3779B97F4A7C15L;
    private static final long MIX_A = 0xBF58476D1CE4E5B9L;
    private static final long MIX_B = 0x94D049BB133111EBL;

    private GoldenFishDraw() {
    }

    /**
     * @param islandId 추첨하는 섬
     * @param minute   추첨 분 — 초 이하를 잘라 넘긴다(자르지 않으면 같은 분이 여러 값을 갖는다)
     * @return {@code [0, SCALE)} 의 고정값. 확률표(ppm)보다 <b>작으면</b> 당첨이다
     */
    public static int roll(UUID islandId, Instant minute) {
        long z = islandId.getMostSignificantBits() * MIX_A
                + islandId.getLeastSignificantBits() * MIX_B
                + minute.getEpochSecond() * GAMMA;
        z = (z ^ (z >>> 30)) * MIX_A;
        z = (z ^ (z >>> 27)) * MIX_B;
        z ^= z >>> 31;
        return (int) Math.floorMod(z, (long) SCALE);
    }
}
