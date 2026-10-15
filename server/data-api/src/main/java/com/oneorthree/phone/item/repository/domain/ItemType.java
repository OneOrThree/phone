package com.oneorthree.phone.item.repository.domain;

/**
 * 아이템의 쓰임새. 착용 칸을 차지하는지 여부가 갈리며, 장식용은 칸(slotType)이 비어 있다.
 */
public enum ItemType {
    /** 착용형 — 착용 칸({@link SlotType})을 하나 차지한다. */
    EQUIPPABLE,
    /** 장식형 — 칸을 쓰지 않으므로 slotType 이 비어 있다. */
    DECORATIVE
}
