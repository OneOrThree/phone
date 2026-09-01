package com.oneorthree.phone.bot.repository.domain;

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

    /**
     * 새벽형 — 03시 기상파까지 포함한다. 04시로는 야간형이 물러나는 새벽 3시대에 아무도 없는
     * 구간이 남았다({@code BotSeedScheduleTest} 가 8주에서 554분을 잡아냈다, 코드리뷰 반영).
     */
    DAWN(3, 12, 24),

    MORNING(8, 15, 26),

    AFTERNOON(13, 20, 26),

    /**
     * 야간형 — 자정을 넘겨 최대 다음날 07시. 새벽에 앱을 켠 유저 눈에도 누군가 보여야 한다.
     *
     * <p>시작을 21시로 늦추고 상한을 07시까지 연 이유는 새벽 커버리지다. 20시 시작이면 대부분
     * 자정 전후에 물러나 새벽 3~4시가 비었다 — 시작이 21~24시로 분산되면서 종료도 새벽 전반에
     * 퍼진다(코드리뷰 반영).
     *
     * <p>창이 좁아 주 30시간 이상을 채울 수 없으므로 고티어 봇에는 배정하지 않는다.
     */
    NIGHT(21, 28, 31);

    /** 집중 1분당 필요한 창(분) — 휴식까지 감안한 경험값. 흔들림 여유 산정도 이 값을 쓴다. */
    public static final double WINDOW_PER_FOCUS_MINUTE = 2.6;

    private final int startHour;
    private final int baseEndHour;
    private final int hardEndHour;

    BotChronotype(int startHour, int baseEndHour, int hardEndHour) {
        this.startHour = startHour;
        this.baseEndHour = baseEndHour;
        this.hardEndHour = hardEndHour;
    }

    /**
     * 집중을 시작할 수 있는 가장 이른 시각(분).
     *
     * @return 기준일 00시(KST)부터의 분. 실제 시작은 여기에 날마다 다른 흔들림이 얹혀 뒤로 밀린다
     */
    public int startMinute() {
        return startHour * 60;
    }

    /**
     * 그날 활동 창의 종료 시각(분). 하루 목표가 클수록 늘어나되 {@code hardEndHour} 를 넘지 않는다.
     *
     * @param dailyMinutes 그날 채워야 할 순수 집중 분
     * @return 기준일 00시(KST)부터의 분. 목표가 아무리 커도 {@link #hardEndMinute()} 를 넘지 않으므로,
     *         창에 다 못 담긴 목표는 그날 채우지 못한 채로 남는다
     */
    public int windowEndMinute(double dailyMinutes) {
        // 휴식까지 감안해 목표의 2.6 배를 창으로 잡는다. 2.2 로는 긴 휴식(50~120분)이 몇 번 끼는 날
        // 마지막 블록이 창 밖으로 밀려 잘리고, 그 손실이 쌓여 주간 총량이 강등선 아래로 떨어졌다.
        double needed = startHour * 60 + dailyMinutes * WINDOW_PER_FOCUS_MINUTE;
        return (int) Math.min(hardEndHour * 60.0, Math.max(baseEndHour * 60.0, needed));
    }

    /**
     * 이 성향이 도달할 수 있는 가장 늦은 시각(분) — 스케줄 검증의 상한.
     *
     * @return 기준일 00시(KST)부터의 분. 1440 을 넘으면 다음날로 넘어간다는 뜻이다
     */
    public int hardEndMinute() {
        return hardEndHour * 60;
    }
}
