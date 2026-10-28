package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /islands/{islandId}/memberships} 명령 본문 (GROMO-1760, 섬 소속 LLD §3.7).
 *
 * @param invitationToken 초대 해석(resolve)이 돌려준 불투명 토큰 — 없으면 일반 가입·신청이다.
 *     서버는 이 값을 그대로 믿지 않고 가입 커밋 안에서 다시 검증한다.
 * @param origin {@code visit}(기본, null 포함) 또는 {@code telescope} (GROMO-2260). 망원경 가입은 그 섬으로
 *     옮기지도 도착을 기록하지도 않는다 — 처음 한 번은 항해해서 가야 한다
 */
public record JoinIslandCommandRequest(
        @Size(max = 64) String invitationToken,
        @Pattern(regexp = "visit|telescope") String origin) {

    public static final String ORIGIN_TELESCOPE = "telescope";

    public JoinIslandCommandRequest(String invitationToken) {
        this(invitationToken, null);
    }

    public boolean fromTelescope() {
        return ORIGIN_TELESCOPE.equals(origin);
    }
}
