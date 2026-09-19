package com.oneorthree.phone.construction.repository.domain;

/**
 * 섬 공동 원장 기입 사유 — 방향(적립/차감)은 서비스 메서드가 정하고 이 값은 이유만 표현한다
 * ({@code CurrencyTransactionType} 과 같은 계약).
 */
public enum IslandWalletTransactionType {
    /** 주민이 섬 통장에 물고기를 쌓았다 — 「각자 몫 n빵」기여의 잔액 쪽 기록. */
    CONTRIBUTION(true),
    /** 건설 확정 시 총액 차감 (정책 C04 · LLD §4-3). */
    CONSTRUCTION_DEBIT(false),
    /**
     * 섬 퀘스트 회차 정산 적립(GROMO-1773) — 보상 전액이 섬 통장으로 간다(2026-09-19 결정 Q-1).
     * 「각자 몫」 기여가 아니라서 주민별 누적 기여를 쌓지 않는다({@code CONTRIBUTION} 과 다른 이유).
     */
    QUEST_SETTLEMENT(true),
    /**
     * 상점 구매 차감(GROMO-1781) — 모든 재화는 섬 귀속이라 개인 상품(옷·소품)도 섬 통장에서 뺀다
     * (2026-09-19 결정 SH-재화).
     */
    SHOP_PURCHASE(false);

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
