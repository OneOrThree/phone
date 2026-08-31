package com.oneorthree.phone.currency.repository.domain;

/**
 * 재화 변동 유형 (DBML: currency_type, 구 currency_reason).
 *
 * <p>EARN/SPEND(잔액 증감 방향)는 earn()/spend() 서비스 메서드가 결정하므로 저장하지 않는다.
 * 이 값은 변동의 "이유"만 표현한다.
 *
 * <p>{@code BET_*} 는 그룹 챌린지 내기 전용이며 <b>서버만</b> 발행한다 — 클라 개방 경로
 * (/currency/earn·spend)는 {@link #isServerOnly()} 가드에 걸려 이 타입을 만들 수 없다.
 */
public enum CurrencyTransactionType {
    SESSION_COMPLETE,
    STREAK_BONUS,
    PURCHASE,

    /** 내기 판돈 차감(에스크로) — 개설·참가 시점. */
    BET_STAKE,
    /** 내기 정산 승자 분배금 지급. */
    BET_PAYOUT,
    /** 달성자 0명 내기의 전원 환불. */
    BET_REFUND,

    /** 집중 목표 달성 보상 — 하루 집중 목표 시간 도달 시 서버가 지급. */
    FOCUS_GOAL,
    /** 스크린타임 목표 달성 보상 — 사용 상한 이하 달성 시 서버가 지급. */
    SCREEN_TIME_GOAL,
    /** 리그 승급 보너스 — 주간 배치 정산에서 상위 티어로 승급 시 서버가 지급. */
    LEAGUE_TIER_BONUS;

    /**
     * 서버 로직만 발행할 수 있는 타입인가 — 금액·발생 시점을 서버가 전적으로 결정하는 유형이다.
     *
     * <p>클라가 타입과 금액을 직접 실어 보내는 {@code /currency/earn·spend} 가 이 타입을 통과시키면
     * 임의 금액 재화 발행이 되고, 원장에 정산 기입과 구분되지 않는 행이 섞여 에스크로·지급 정합을
     * 검증할 수 없게 된다. 그래서 클라 경로에서는 타입 자체를 거절한다
     * ({@link com.oneorthree.phone.currency.service.InGameCurrencyService}).
     */
    public boolean isServerOnly() {
        return this == BET_STAKE || this == BET_PAYOUT || this == BET_REFUND
                || this == FOCUS_GOAL || this == SCREEN_TIME_GOAL || this == LEAGUE_TIER_BONUS;
    }
}
