package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.ShopOrderRequest;
import com.oneorthree.phone.shop.dto.ShopViews;
import com.oneorthree.phone.shop.service.ShopService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 상점의 내부 표면 (GROMO-1781, island-shop LLD §2) — 공개 {@code /islands/{islandId}/shop/**} 다섯 계약의
 * 상류다. 주체는 {@code InternalAuthFilter} 가 서비스 토큰과 함께 검증한 {@code X-User-Id} 로만 받고, 목록
 * 경계는 Business 가 서명 커서를 풀어 넘긴다.
 */
@RestController
@RequiredArgsConstructor
public class InternalShopController {

    private final ShopService shop;

    @GetMapping("/internal/islands/{islandId}/shop/wallets")
    public ShopViews.Wallets wallets(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId) {
        return shop.wallets(islandId, userId);
    }

    @GetMapping("/internal/islands/{islandId}/shop/products")
    public ShopViews.ProductPage products(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestParam String category, @RequestParam(required = false) Long publicationVersion,
            @RequestParam(required = false) Integer afterDisplayOrder,
            @RequestParam(required = false) String afterProductId, @RequestParam int limit) {
        return shop.products(islandId, userId, category, publicationVersion, afterDisplayOrder, afterProductId,
                limit);
    }

    @GetMapping("/internal/islands/{islandId}/shop/products/{productId}")
    public ShopViews.Product product(@PathVariable UUID islandId, @PathVariable String productId,
            @RequestHeader("X-User-Id") UUID userId) {
        return shop.product(islandId, userId, productId);
    }

    /** 구매 — 성공은 201. 같은 키·같은 본문은 원 결과 재생이다. */
    @PostMapping("/internal/islands/{islandId}/shop/orders")
    @ResponseStatus(HttpStatus.CREATED)
    public ShopViews.Order purchase(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey, @Valid @RequestBody ShopOrderRequest body) {
        return shop.purchase(islandId, userId, body.productId(), body.expectedWalletVersion(),
                body.expectedProductVersion(), idempotencyKey);
    }

    @GetMapping("/internal/islands/{islandId}/shop/orders")
    public ShopViews.OrderPage orders(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestParam String scope, @RequestParam(required = false) Instant afterCreatedAt,
            @RequestParam(required = false) UUID afterId, @RequestParam int limit) {
        return shop.orders(islandId, userId, scope, afterCreatedAt, afterId, limit);
    }
}
