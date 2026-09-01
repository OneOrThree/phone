package com.oneorthree.phone.item.dto;

import com.oneorthree.phone.item.repository.domain.Item;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/**
 * 아이템 카탈로그 정보. 가격은 결제 수단에 따라 한쪽만 채워질 수 있어
 * {@code currencyPrice}·{@code premiumPrice} 중 어느 쪽을 볼지는 {@code paymentType} 이 정한다.
 * 칸을 차지하지 않는 장식 아이템은 {@code slotType} 이 null 이다.
 */
@Getter
@Builder
public class ItemResponse {
    private UUID id;
    private String name;
    private String itemType;
    private String slotType;
    private String grade;
    private String assetUrl;
    private String paymentType;
    private Integer currencyPrice;
    private Integer premiumPrice;

    /**
     * 아이템 엔티티를 응답 형태로 옮긴다.
     *
     * @param item 변환할 아이템
     * @return 카탈로그 응답. 열거형 값은 이름 문자열로 펴지고, 칸이 없는 아이템의 slotType 은 null 이다
     */
    public static ItemResponse from(Item item) {
        return ItemResponse.builder()
                .id(item.getId())
                .name(item.getName())
                .itemType(item.getItemType().name())
                .slotType(item.getSlotType() != null ? item.getSlotType().name() : null)
                .grade(item.getGrade())
                .assetUrl(item.getAssetUrl())
                .paymentType(item.getPaymentType().name())
                .currencyPrice(item.getCurrencyPrice())
                .premiumPrice(item.getPremiumPrice())
                .build();
    }
}
