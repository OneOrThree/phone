package com.oneorthree.phone.bot.domain;

/**
 * 봇의 활동 시간대 성향 (GROMO-1565).
 *
 * <p>시각 단위는 <b>KST 그날 00시 기준 시(hour)</b> 이고 24 를 넘는 값은 다음날을 뜻한다
 * ({@code NIGHT} 의 27 = 다음날 03시).
 *
 * <p>{@code hardEndHour} 가 필요한 이유: 활동 창은 하루 목표량에 따라 늘어나는데
 * ({@code BotScheduleGenerator}), 상한이 없으면 목표가 큰 봇이 창을 무한정 늘려 다음날 오후까지
 * 집중하게 된다. 사람이 하루에 깨어 있는 범위를 성향마다 못 박는다.
 */
public enum BotChronotype {

    /** 새벽형 — 04시 기상파(미라클모닝)까지 포함해 야간형이 빠지는 새벽 틈을 메운다. */
    DAWN(4, 12, 24),

    MORNING(8, 15, 26),

    AFTERNOON(13, 20, 26),

    /**
     * 야간형 — 자정을 넘겨 최대 다음날 06시. 새벽에 앱을 켠 유저 눈에도 누군가 보여야 한다.
     *
     * <p>창이 좁아(20시~다음날 06시) 주 30시간 이상을 채울 수 없으므로 고티어 봇에는 배정하지 않는다.
     */
    NIGHT(20, 27, 30);

    private final int startHour;
    private final int baseEndHour;
    private final int hardEndHour;

    BotChronotype(int startHour, int baseEndHour, int hardEndHour) {
        this.startHour = startHour;
        this.baseEndHour = baseEndHour;
        this.hardEndHour = hardEndHour;
    }

    /** 집중을 시작할 수 있는 가장 이른 시각(분). */
    public int startMinute() {
        return startHour * 60;
    }

    /**
     * 그날 활동 창의 종료 시각(분). 하루 목표가 클수록 늘어나되 {@code hardEndHour} 를 넘지 않는다.
     *
     * @param dailyMinutes 그날 채워야 할 순수 집중 분
     */
    public int windowEndMinute(double dailyMinutes) {
        // 휴식까지 감안해 목표의 2.2 배를 창으로 잡는다 — 이보다 좁으면 목표를 채우지 못하고 잘린다.
        double needed = startHour * 60 + dailyMinutes * 2.2;
        return (int) Math.min(hardEndHour * 60.0, Math.max(baseEndHour * 60.0, needed));
    }

    /** 이 성향이 도달할 수 있는 가장 늦은 시각(분) — 스케줄 검증의 상한. */
    public int hardEndMinute() {
        return hardEndHour * 60;
    }
}
