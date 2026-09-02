package com.oneorthree.phone.item.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * 상점 아이템 원본. 유저 보유·착용과 무관한 카탈로그 항목이다.
 *
 * <p>{@code slotType} 이 null 인 아이템은 착용 칸을 차지하지 않는 장식용이고, 가격은
 * {@code paymentType} 이 가리키는 쪽만 채워진다 — 두 가격 필드가 함께 비어 있을 수도 있다.
 * 판매를 내릴 때는 행을 지우지 않고 {@code isActive} 를 내린다(이미 산 유저의 보유가 깨지지 않도록).
 */
@Entity
@Table(name = "items")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Item {

    @Id
    @GeneratedUuidV7
    private UUID id;

    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "item_type", nullable = false)
    private ItemType itemType;

    @Enumerated(EnumType.STRING)
    @Column(name = "slot_type")
    private SlotType slotType;

    @Column(nullable = false)
    private String grade;

    @Column(name = "asset_url")
    private String assetUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_type", nullable = false)
    private PriceType paymentType;

    @Column(name = "currency_price")
    private Integer currencyPrice;

    @Column(name = "premium_price")
    private Integer premiumPrice;

    @Column(columnDefinition = "text")
    private String description;

    @Builder.Default
    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}
