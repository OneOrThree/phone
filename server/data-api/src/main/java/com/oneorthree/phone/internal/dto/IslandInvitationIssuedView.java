package com.oneorthree.phone.internal.dto;

import java.time.Instant;

/**
 * {@code POST /islands/{islandId}/invitations} 응답 (GROMO-1760, 섬 소속 LLD §3.11).
 *
 * @param code 발급자당 활성 재사용 코드 — 이미 유효한 코드가 있으면 같은 값을 돌려준다
 * @param url 앱이 공유에 쓰는 링크 — 코드와 같은 초대를 가리킨다
 * @param expiresAt 만료 — <b>이번 정책은 TTL 이 없으므로 항상 null</b>. 폐기는 시간이 아니라
 *     발급자의 멤버십 세대 변화(이탈·강퇴·재가입)로만 일어난다
 */
public record IslandInvitationIssuedView(
        String code,
        String url,
        Instant expiresAt) {
}
