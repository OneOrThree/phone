package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /invitations/resolve} 명령 본문 (GROMO-1760, 섬 소속 LLD §3.10).
 *
 * @param code   사용자가 입력한 초대 코드 — 정규화(trim·소문자)는 서비스가 한다
 * @param arrive true 면 그 섬에 도착까지 한다(GROMO-2264). 없거나 false 면 종전 미리보기다 — 도착은 명시적 opt-in 이다
 */
public record InvitationResolveCommandRequest(
        @NotBlank @Size(max = 32) String code,
        Boolean arrive) {

    public InvitationResolveCommandRequest(String code) {
        this(code, null);
    }

    public boolean arriving() {
        return Boolean.TRUE.equals(arrive);
    }
}
