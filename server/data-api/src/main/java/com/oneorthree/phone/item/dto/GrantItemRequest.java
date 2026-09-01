package com.oneorthree.phone.item.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * 아이템 지급 요청 바디. 다른 요청들과 달리 대상 유저를 바디로 받는 운영·테스트용 통로라,
 * 인증 주체와 지급 대상이 다를 수 있다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GrantItemRequest {
    private UUID userId;
    private UUID itemId;
}
