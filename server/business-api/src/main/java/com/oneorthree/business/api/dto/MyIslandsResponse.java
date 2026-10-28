package com.oneorthree.business.api.dto;

import com.oneorthree.business.api.dto.IslandMembershipResponses.IslandSummaryView;

import java.util.List;
import java.util.UUID;

/**
 * {@code GET /me/islands} 공개 응답 (GROMO-1759, LLD §3.5).
 *
 * <p>{@code nextCursor} 는 <b>항상 null</b> 이다 — 소속 상한이 10 이라 목록이 전량이기 때문이다. 키
 * 자체는 남겨 둔다. 상한이 바뀌어 페이지가 생길 때 앱이 읽는 자리를 미리 고정해 두는 편이, 나중에
 * 없던 키를 더하는 것보다 안전하다(LLD §3.5 가 "향후 상한 변경은 페이지 계약을 함께 개정한다"고
 * 한 자리다).
 *
 * <p>{@code lossReason} 은 «왜 현재 섬이 없는지» 다 (GROMO-2038) — {@code LEFT}(마지막 섬에서 자진 이탈)·
 * {@code KICKED}(현재 섬에서 강퇴 — 다른 소속이 남아 있어도 먼바다다, GROMO-2315)·null(한 번도 소속된 적 없음).
 * 그래서 {@code KICKED} 면 {@code items} 가 비어 있지 않을 수 있다. 앱은 이 값으로 강퇴 안내를 한 번 띄우고
 * 먼바다로 간다(GROMO-2366). 재가입 제한·쿨다운은 없다 — 강퇴된 섬의 재가입은 승인 대기 신청이다.
 *
 * <p><b>불변</b>: {@code currentIslandId} 가 있으면 {@code lossReason} 은 null 이다. Data 의 저장
 * CHECK(V84)와 같은 불변이고, 어긋난 상류 응답은 {@code IslandMembershipUseCase#myIslands} 가 502 로
 * 끊는다 — 앱에 「섬이 있는데 잃었다」를 내려보내지 않는다.
 */
public record MyIslandsResponse(List<IslandSummaryView> items, String nextCursor, UUID currentIslandId,
        String lossReason) {
}
