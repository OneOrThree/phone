package com.oneorthree.phone.item.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class EquipRequest {
    /**
     * 장착 대상은 항상 인증 주체다 — 클라이언트가 대상 유저를 지정할 통로를 두지 않는다 (GROMO-363).
     */
    private UUID itemId;
}
