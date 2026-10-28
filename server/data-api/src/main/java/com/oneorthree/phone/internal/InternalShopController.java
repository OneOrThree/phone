package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.ShopOrderRequest;
import com.oneorthree.phone.internal.service.GuestAccountGuards;
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
    private final GuestAccountGuards guestAccountGuards;

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

    /**
     * 구매 — 성공은 201. 같은 키·같은 본문은 원 결과 재생이다.
     *
     * <p>게스트는 여기서 막힌다 (GROMO-1992, 정책 「…상점 구매를 처음 시도할 때 소셜 로그인을
     * 요청한다」). {@code publicCommands.run} <b>앞</b> 이라 거절된 게스트는 멱등 receipt 를
     * 남기지 않는다 — 남기면 소셜 로그인을 마친 뒤 같은 키로 다시 눌렀을 때 실패가 재생된다.
     * <p>이 가드는 <b>계정 상태</b> 축이고, 「구매=주민 / 건설=방장」({@code ShopService.requireSpender})
     * 은 <b>섬 안의 역할</b> 축이다 — 둘은 서로를 대신하지 못하므로 나란히 둔다.
     */
    @PostMapping("/internal/islands/{islandId}/shop/orders")
    @ResponseStatus(HttpStatus.CREATED)
    public ShopViews.Order purchase(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey, @Valid @RequestBody ShopOrderRequest body) {
        guestAccountGuards.requireMember(userId);
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
