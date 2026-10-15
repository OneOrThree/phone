package com.oneorthree.phone.item.repository.domain;

/**
 * 캐릭터의 착용 칸. 한 칸에는 한 번에 하나만 걸리며, 같은 칸에 새로 착용하면 기존 것이 자동으로 밀려난다.
 */
public enum SlotType {
    /** 머리. */
    HAIR,
    /** 상의. */
    TOP,
    /** 하의. */
    BOTTOM,
    /** 신발. */
    SHOES
}
