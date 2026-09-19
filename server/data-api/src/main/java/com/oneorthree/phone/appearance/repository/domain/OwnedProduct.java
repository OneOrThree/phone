package com.oneorthree.phone.appearance.repository.domain;

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
 * 보유 상품 (GROMO-1783) — {@code (주인, 상품)} 유일. 주인은 user 또는 island(groups) 정확히
 * 하나다 (부분 유일 인덱스 + CHECK). 지급 writer 는 상점 구매(1781)이며, 이 도메인은 소유 여부만
 * 읽는다. raft 에는 이 행을 만들지 않는다 — 기본 선체는 소유 판정 밖의 예약 표현이다.
 */
@Entity
@Table(name = "owned_products")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OwnedProduct {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "owner_type", nullable = false, length = 10)
    private String ownerType;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "group_id")
    private UUID groupId;

    @Column(name = "product_id", nullable = false, length = 80)
    private String productId;

    /** 주문 ID 또는 명시 지급 근거 — 지급 writer 가 채운다. */
    @Column(name = "granted_ref", length = 120)
    private String grantedRef;

    @Column(name = "granted_at", nullable = false)
    private Instant grantedAt;

    /**
     * 지급 한 건 — 주인 축은 {@code ownerType} 이 정한다(user 면 userId, island 면 groupId 만 채운다 — CHECK).
     * 상점 구매(1781)는 {@code grantedRef} 에 주문 ID 를 싣는다.
     */
    public static OwnedProduct granted(String ownerType, UUID ownerId, String productId, String grantedRef,
                                       Instant grantedAt) {
        OwnedProduct owned = new OwnedProduct();
        owned.ownerType = ownerType;
        if (CatalogAsset.OWNER_USER.equals(ownerType)) {
            owned.userId = ownerId;
        } else {
            owned.groupId = ownerId;
        }
        owned.productId = productId;
        owned.grantedRef = grantedRef;
        owned.grantedAt = grantedAt;
        return owned;
    }
}
