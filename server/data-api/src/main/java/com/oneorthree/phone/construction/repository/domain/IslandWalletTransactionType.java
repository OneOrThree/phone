package com.oneorthree.phone.construction.repository.domain;

/**
 * 섬 공동 원장 기입 사유 — 방향(적립/차감)은 서비스 메서드가 정하고 이 값은 이유만 표현한다
 * ({@code CurrencyTransactionType} 과 같은 계약).
 */
public enum IslandWalletTransactionType {
    /** 주민이 섬 통장에 물고기를 쌓았다 — 「각자 몫 n빵」기여의 잔액 쪽 기록. */
    CONTRIBUTION(true),
    /** 건설 확정 시 총액 차감 (정책 C04 · LLD §4-3). */
    CONSTRUCTION_DEBIT(false);

    private final boolean earning;

    IslandWalletTransactionType(boolean earning) {
        this.earning = earning;
    }

    /**
     * 공동 가계부(GROMO-1895)의 방향 — 적립({@code earn})인가 지출({@code spend})인가. 원장 행은 금액을
     * 항상 양수로 적으므로 방향은 사유가 정한다. 새 사유를 더하면 여기서 방향도 함께 정해야 한다.
     */
    public boolean isEarning() {
        return earning;
    }
}
