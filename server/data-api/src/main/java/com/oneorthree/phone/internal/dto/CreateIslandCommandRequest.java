package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /internal/users/{userId}/islands} 요청 본문 (GROMO-1759, LLD §3.1).
 *
 * <p>길이 50/200 은 기존 {@code CreateGroupRequest} 의 검증값을 그대로 쓴다. 본문에 {@code maxMembers}
 * 나 {@code password} 를 받지 않는 것이 계약이다 — LLD §1 이 "새 DTO 에 없는 password/maxMembers 를
 * client 가 주입하지 못함"을 명시했다. 정원은 기존 기본값 10 으로 서버가 정한다.
 *
 * <p>여기 검증은 <b>이중 방어</b> 다. 모양 거절은 Business 가 네트워크 전에 먼저 한다(400).
 */
public record CreateIslandCommandRequest(
        @NotBlank @Size(max = 50) String name,
        @Size(max = 200) String intro,
        @NotNull Boolean approvalRequired) {
}
