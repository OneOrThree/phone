package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /internal/islands/{islandId}/shop/orders} 요청 본문 (island-shop LLD §2.4). 가격·통화·주인·수량은
 * 받지 않는다 — 서버가 활성 판매 revision 에서 정한다. 두 version 은 «사용자가 본 가격·잔액»의 동의 증거다.
 */
public record ShopOrderRequest(
        @NotBlank @Size(max = 80) String productId,
        @NotNull @PositiveOrZero Long expectedWalletVersion,
        @NotNull @PositiveOrZero Long expectedProductVersion) {
}
