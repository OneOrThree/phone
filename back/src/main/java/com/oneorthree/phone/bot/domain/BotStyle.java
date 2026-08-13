package com.oneorthree.phone.bot.domain;

/**
 * 봇의 집중 스타일 (GROMO-1565) — 한 번에 얼마나 오래 앉고 얼마나 쉬는지.
 *
 * <p>어떤 스타일도 블록이 110분을 넘지 않는다. 3시간 연속 집중은 사람이 하지 않는 패턴이라
 * 그대로 두면 봇 티가 난다.
 */
public enum BotStyle {

    /** 짧게 여러 번. */
    POMODORO(25, 50, 10, 20),

    MIXED(45, 75, 15, 30),

    /** 길게 몇 번. */
    DEEP(70, 110, 25, 45);

    /** 어떤 스타일도 넘지 못하는 단일 블록 상한(분) — 검증 기준이기도 하다. */
    public static final int MAX_BLOCK_MINUTES = 110;

    private final int minBlockMinutes;
    private final int maxBlockMinutes;
    private final int minRestMinutes;
    private final int maxRestMinutes;

    BotStyle(int minBlockMinutes, int maxBlockMinutes, int minRestMinutes, int maxRestMinutes) {
        this.minBlockMinutes = minBlockMinutes;
        this.maxBlockMinutes = maxBlockMinutes;
        this.minRestMinutes = minRestMinutes;
        this.maxRestMinutes = maxRestMinutes;
    }

    /**
     * 블록 길이(분)를 뽑는다.
     *
     * @param roll 0.0 이상 1.0 미만 난수
     */
    public int blockMinutes(double roll) {
        return minBlockMinutes + (int) (roll * (maxBlockMinutes - minBlockMinutes));
    }

    /**
     * 블록 사이 휴식(분)을 뽑는다.
     *
     * @param roll 0.0 이상 1.0 미만 난수
     */
    public int restMinutes(double roll) {
        return minRestMinutes + (int) (roll * (maxRestMinutes - minRestMinutes));
    }

    /** 남은 목표가 이 값보다 적으면 블록 하나를 더 열지 않고 그날을 끝낸다. */
    public int minimumWorthwhileMinutes() {
        return (int) (minBlockMinutes * 0.6);
    }
}
