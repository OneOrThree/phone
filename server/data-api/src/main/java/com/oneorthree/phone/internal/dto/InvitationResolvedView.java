package com.oneorthree.phone.internal.dto;

/**
 * {@code POST /invitations/resolve} 응답 (GROMO-1760, 섬 소속 LLD §3.10).
 *
 * @param island 초대가 가리키는 섬의 공개 요약 — 본인 기준 membershipStatus·joinRequestId 포함
 * @param invitationToken 가입 명령에 실어 보낼 불투명 토큰 — 그 자체가 가입 권한은 아니고,
 *     서버는 가입 커밋 안에서 이 참조를 다시 검증한다
 */
public record InvitationResolvedView(
        IslandSummaryView island,
        String invitationToken) {
}
