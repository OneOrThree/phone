package com.oneorthree.phone.domain;

import jakarta.persistence.*;
import lombok.*;
import org.aspectj.weaver.patterns.ConcreteCflowPointcut;

@Entity
@Table(name = "itmes")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Item {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;            // 아이템 이름
    private String description;     // 아이템 설명

    @Column(name = "asset_address")
    private String assetAddress;    // 3D 에셋 경로 (URL)

    @Column(name = "thumbnail_url")
    private String thumbnailUrl;    // 인벤토리 썸네일 경

    @Enumerated(EnumType.STRING)
    @Column(name = "slot_type", nullable = false)
    private SlotType slotType;      // 모자, 머리, 상의, 하의, 엑세서리

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Rarity rarity;          // common, rare, epic, legendary
}
