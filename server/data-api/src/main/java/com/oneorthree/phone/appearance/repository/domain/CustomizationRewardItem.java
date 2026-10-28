package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 꾸미기 보상 후보 한 줄 (GROMO-2313 V133) — 정책 revision 별 목록이다. 서버는 읽기만 한다.
 *
 * <p>그림 자료({@code render_data})·원본 id·희귀도 근거는 추첨에 쓰지 않아 매핑하지 않는다.
 */
@Entity
@Table(name = "customization_reward_items")
@IdClass(CustomizationRewardItem.Key.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class CustomizationRewardItem {

    @Id
    @Column(name = "revision", nullable = false)
    private int revision;

    @Id
    @Column(name = "product_id", nullable = false, length = 80)
    private String productId;

    /** head·neck·shoes 또는 뗏목 6분류 — 장착 슬롯이 아니라 추첨 카테고리다. */
    @Column(name = "category", nullable = false, length = 10)
    private String category;

    /** common·uncommon·rare·legendary. */
    @Column(name = "rarity", nullable = false, length = 10)
    private String rarity;

    /** 누적합 순서의 첫 키 — 같으면 상품 id 순이다. */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    /** 복합 PK — (revision, productId). */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private int revision;
        private String productId;
    }
}
