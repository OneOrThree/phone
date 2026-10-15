package com.oneorthree.phone.shop.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 상점 주문 (GROMO-1781, island-shop LLD §3) — 섬 하나에 귀속된다(BG18, 2026-09-19 결정).
 * 결제 당시 revision·가격·통화를 불변 snapshot 으로 보존한다.
 *
 * <p>결제자는 지금 섬 통장뿐이다({@code payerType=island}, {@code payerUserId=null}). 개인 지갑
 * 결제는 테이블 CHECK 를 넓혀 추가한다. {@code balanceAfter}·{@code analyticsDeliveredAt} 은
 * {@code currency_spent} 내구 전달 의도다 — 주문 id 가 분석 사건 id 다.
 */
@Entity
@Table(name = "shop_orders")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ShopOrder {

    public static final String PAYER_ISLAND = "island";

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Column(name = "requester_id", nullable = false)
    private UUID requesterId;

    /** 상품의 불변 ownerType — user 면 requester 본인, island 면 islandId 가 주인이다. */
    @Column(name = "owner_type", nullable = false, length = 10)
    private String ownerType;

    @Column(name = "product_id", nullable = false, length = 80)
    private String productId;

    @Column(name = "product_revision", nullable = false)
    private int productRevision;

    @Column(name = "paid_price", nullable = false)
    private int paidPrice;

    @Column(nullable = false, length = 20)
    private String currency;

    @Column(name = "payer_type", nullable = false, length = 10)
    private String payerType;

    @Column(name = "payer_user_id")
    private UUID payerUserId;

    @Column(name = "wallet_version_after", nullable = false)
    private long walletVersionAfter;

    @Column(name = "balance_after", nullable = false)
    private int balanceAfter;

    @Column(name = "analytics_delivered_at")
    private Instant analyticsDeliveredAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /**
     * 확정 주문 — 결제 당시 revision·가격·통화와 차감 직후 지갑 version·잔액을 불변 snapshot 으로 남긴다.
     * 결제자는 섬 통장뿐이라 {@code payerType=island} 고정이다. {@code analyticsDeliveredAt=null} 이 곧
     * {@code currency_spent} 미전달 의도다(LLD §5 계측 의무 — 주문 id 가 분석 사건 id).
     */
    public static ShopOrder placed(UUID islandId, UUID requesterId, String ownerType, String productId,
                                   int productRevision, int paidPrice, String currency, long walletVersionAfter,
                                   int balanceAfter, Instant createdAt) {
        ShopOrder o = new ShopOrder();
        o.islandId = islandId;
        o.requesterId = requesterId;
        o.ownerType = ownerType;
        o.productId = productId;
        o.productRevision = productRevision;
        o.paidPrice = paidPrice;
        o.currency = currency;
        o.payerType = PAYER_ISLAND;
        o.walletVersionAfter = walletVersionAfter;
        o.balanceAfter = balanceAfter;
        o.createdAt = createdAt;
        return o;
    }
}
