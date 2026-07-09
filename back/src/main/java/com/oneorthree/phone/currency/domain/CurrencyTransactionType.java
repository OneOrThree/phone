package com.oneorthree.phone.currency.domain;

/**
 * 재화 변동 유형 (DBML: currency_type, 구 currency_reason).
 *
 * <p>EARN/SPEND(잔액 증감 방향)는 earn()/spend() 서비스 메서드가 결정하므로 저장하지 않는다.
 * 이 값은 변동의 "이유"만 표현한다.
 */
public enum CurrencyTransactionType {
    SESSION_COMPLETE, STREAK_BONUS, PURCHASE
}
