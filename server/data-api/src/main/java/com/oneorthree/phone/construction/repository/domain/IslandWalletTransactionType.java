package com.oneorthree.phone.construction.repository.domain;

/**
 * 섬 공동 원장 기입 사유 — 방향(적립/차감)은 서비스 메서드가 정하고 이 값은 이유만 표현한다
 * ({@code CurrencyTransactionType} 과 같은 계약).
 */
public enum IslandWalletTransactionType {
    /** 주민이 섬 통장에 물고기를 쌓았다 — 「각자 몫 n빵」기여의 잔액 쪽 기록. */
    CONTRIBUTION,
    /** 건설 확정 시 총액 차감 (정책 C04 · LLD §4-3). */
    CONSTRUCTION_DEBIT
}
