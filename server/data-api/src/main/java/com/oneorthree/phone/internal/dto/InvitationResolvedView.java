package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code POST /invitations/resolve} 응답 (GROMO-1760, 섬 소속 LLD §3.10).
 *
 * @param island 초대가 가리키는 섬의 공개 요약 — 본인 기준 membershipStatus·joinRequestId 포함. 해석이 도착(누구나
 *     가입 섬은 가입까지)을 마친 <b>뒤</b>의 값이다(GROMO-2264)
 * @param invitationToken 가입 명령에 실어 보낼 불투명 토큰 — 그 자체가 가입 권한은 아니고,
 *     서버는 가입 커밋 안에서 이 참조를 다시 검증한다
 * @param arrival 초대로 그 섬에 도착한 결과 (GROMO-2264, 섬 외부 계약 §4). 도착을 요청({@code arrive=true})하지 않은
 *     미리보기면 null 이다
 */
public record InvitationResolvedView(
        IslandSummaryView island,
        String invitationToken,
        Arrival arrival) {

    /**
     * 초대 도착 결과 — 해석은 항해 없이 그 섬 1곳에 도착을 남기고, 누구나 가입 섬이면 가입까지 한다. 승인제 섬은 도착만이다
     * (승인 전까지 방문자, 가입 신청은 방문자가 직접 한다).
     *
     * @param arrived          항상 true — 이 해석이 그 섬에 도착을 남겼다
     * @param membershipStatus {@code active|pending|none} — 해석 뒤 본인 기준. {@code pending} 은 이미 열려 있던 신청이다
     * @param reason           바로 가입하지 않은 사유. {@code ISLAND_LIMIT}(소속 섬 3개 — 가입·신청 모두 불가) ·
     *     {@code KICKED}(강퇴된 섬 — 도착만 남기고, 가입 신청은 승인 대기로 할 수 있다. GROMO-2315 전에는 신청도 403),
     *     없으면 null
     */
    public record Arrival(UUID islandId, boolean arrived, String membershipStatus, String reason) {
    }
}
