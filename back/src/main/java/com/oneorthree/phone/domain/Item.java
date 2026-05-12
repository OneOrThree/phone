package com.oneorthree.phone.domain;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.aspectj.weaver.patterns.ConcreteCflowPointcut;

@Entity
@Table(name = "itmes")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Item {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;            // 아이템 이름
    private String description;     // 아이템 설명
    private String assetAddress;    // 3D 에셋 경로 (URL)
    private String thumbnailUrl;    // 인벤토리 썸네일 경

    private SlotType slotType;      // 모자, 머리, 상의, 하의, 엑세서리
    private Rarity rarity;          // common, rare, epic, legendary
}
