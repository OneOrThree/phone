package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /invitations/resolve} 명령 본문 (GROMO-1760, 섬 소속 LLD §3.10).
 *
 * @param code 사용자가 입력한 초대 코드 — 정규화(trim·소문자)는 서비스가 한다
 */
public record InvitationResolveCommandRequest(
        @NotBlank @Size(max = 32) String code) {
}
