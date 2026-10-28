package com.oneorthree.phone.shop.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 상점 판매 revision (GROMO-1781, island-shop LLD §3) — {@code (productId, revision)} 유일, 발행 후 불변.
 *
 * <p>제목·kind·ownerType 은 {@code catalog_assets}(V64) 가 정본이라 여기 두지 않는다.
 * {@code price} 가 null 이면 승인 가격이 없다는 뜻이고 구매는 불가다 — 0원으로 해석하지 않는다(정책 S03).
 */
@Entity
@Table(name = "shop_product_revisions")
@IdClass(ShopProductRevisionId.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ShopProductRevision {

    /** 섬 통장(섬 물고기)의 서버 통화 식별자 — 개명 미결로 원본 계약 값 그대로(정책 D1). */
    public static final String CURRENCY_VILLAGE_POINTS = "village_points";

    @Id
    @Column(name = "product_id", nullable = false, length = 80)
    private String productId;

    @Id
    @Column(nullable = false)
    private int revision;

    /** 결제 통화 — 모든 재화는 섬 귀속이라 현재 {@code village_points} 뿐이다(2026-09-19 결정). */
    @Column(nullable = false, length = 20)
    private String currency;

    /** 승인된 가격. null = 미승인(구매 불가). */
    @Column
    private Integer price;

    @Column(name = "required_building", length = 30)
    private String requiredBuilding;

    @Column(name = "required_product_id", length = 80)
    private String requiredProductId;

    /** 서버 등록 미리듣기 media 키 — 음원 상품만 쓴다. */
    @Column(name = "preview_media_key", length = 200)
    private String previewMediaKey;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /**
     * 판매 revision 한 행 — 카탈로그 발행(운영 데이터 투입)의 생성 경로. 가격 미승인은 {@code price=null} 로만
     * 넣는다(0원 금지 — DB CHECK). 통화는 섬 통장 {@code village_points} 하나다.
     */
    public static ShopProductRevision of(String productId, int revision, Integer price, String requiredBuilding,
                                         String requiredProductId, String previewMediaKey, Instant createdAt) {
        ShopProductRevision r = new ShopProductRevision();
        r.productId = productId;
        r.revision = revision;
        r.currency = CURRENCY_VILLAGE_POINTS;
        r.price = price;
        r.requiredBuilding = requiredBuilding;
        r.requiredProductId = requiredProductId;
        r.previewMediaKey = previewMediaKey;
        r.createdAt = createdAt;
        return r;
    }
}
