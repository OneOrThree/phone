package com.oneorthree.phone.stats.support;

/**
 * 통계 단위 환산 유틸(정적).
 *
 * <p>산재해 있던 {@code /60}(초→분) 내림과 목표 대비 진행도(%) 계산을 한곳으로 모은다.
 * 상태가 없으므로 {@code static} 메서드만 노출하고 인스턴스화를 막는다(GROMO-779 리팩토링).
 */
public final class StatsUnits {

    private StatsUnits() {
    }

    /**
     * 초를 분으로 내림 환산한다(정수 나눗셈 = floor). 1분 미만 자투리 초는 버린다.
     *
     * <p>GROMO-642: 저장은 초 단위(total_focus_seconds)로 하고, 응답 계약은 분이므로
     * 합산 후 1회만 이 메서드로 내림한다(세션별 내림을 반복하면 자투리 초가 누적 손실된다).
     *
     * @param seconds 누적 초
     * @return 내림된 분
     */
    public static int secondsToMinutes(int seconds) {
        return seconds / 60;
    }

    /**
     * 목표 대비 진행도(%). 현행 동작 그대로 보존한다.
     *
     * <p>목표 미설정(goal=0)이면 0%를 반환하고, 목표 초과 시 100을 넘는 값을 클램프 없이 그대로 노출한다.
     * 계산은 {@code Math.round((double) actual / goal * 100)} 반올림.
     *
     * @param actual 실제 값(분)
     * @param goal   목표 값(분)
     * @return 진행도(%). goal &le; 0 이면 0.
     */
    public static int progressPercent(int actual, int goal) {
        return goal > 0 ? (int) Math.round((double) actual / goal * 100) : 0;
    }
}
