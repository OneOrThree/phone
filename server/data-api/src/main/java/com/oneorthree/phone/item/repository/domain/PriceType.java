package com.oneorthree.phone.item.repository.domain;

/**
 * 아이템을 어떤 수단으로 살 수 있는지. 이 값이 아이템의 두 가격 필드 중 어느 쪽을 읽을지 정한다
 * — 해당하지 않는 쪽은 비어 있을 수 있다.
 */
public enum PriceType {
    /** 인게임 코인으로만 산다 — premiumPrice 는 보지 않는다. */
    CURRENCY,
    /** 유료 재화로만 산다 — currencyPrice 는 보지 않는다. */
    PREMIUM,
    /** 두 수단 다 가능 — 어느 쪽으로 결제할지는 구매 시점에 정한다. */
    BOTH
}
