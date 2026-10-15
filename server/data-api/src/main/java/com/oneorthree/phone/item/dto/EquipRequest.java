package com.oneorthree.phone.item.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * 장착 요청 바디. 어느 칸에 넣을지는 담지 않는다 — 칸은 아이템 자신이 들고 있고,
 * 그 칸에 이미 걸친 것은 자동으로 교체된다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class EquipRequest {
    /**
     * 장착 대상은 항상 인증 주체다 — 클라이언트가 대상 유저를 지정할 통로를 두지 않는다 (GROMO-363).
     */
    private UUID itemId;
}
