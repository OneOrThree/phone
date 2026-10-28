package com.oneorthree.phone.user.dto;

import java.util.UUID;

/** 내가 차단한 사용자 한 명. 차단 관계는 blocker 기준 단방향이다 (GROMO-1975). */
public record BlockedUserResponse(UUID id, String name) {
}
