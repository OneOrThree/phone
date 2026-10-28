package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.group.repository.domain.GroupLeaveReason;

import java.util.List;
import java.util.UUID;

/**
 * {@code GET /internal/users/{userId}/islands} 응답 (GROMO-1759, LLD §3.5).
 *
 * <p>페이지가 없다 — 현재 소속 상한이 3 이라(GROMO-2260) 목록은 전량이다. 공개 계약의 {@code nextCursor} 는
 * 항상 null 이고 그 상수는 Business 가 채운다.
 *
 * <p>{@code currentIslandId} 는 <b>지금도 활성 소속인 섬이거나 null</b> 이다(LLD §3.5). 저장된 컨텍스트가
 * 더 이상 활성 소속이 아니면 그 값을 «그대로 보여주지 않고» null 로 내려보낸다 — 권한 없는 대상을
 * 현재 섬으로 표시하지 않기 위해서다.
 *
 * <p>{@code lossReason} 은 «왜 현재 섬이 없는지» 다 (GROMO-2038). null 인 {@code currentIslandId} 를
 * 두 상태로 가른다 — 사유가 없으면 «한 번도 소속된 적 없음»(온보딩 첫 진입), 있으면 현재 섬을 잃은 것이다.
 * {@code LEFT} 는 마지막 섬에서 자진 이탈했다(남은 섬이 있으면 그리로 옮겨져 사유가 없다). {@code KICKED} 는
 * 현재 섬에서 강퇴됐다 — <b>다른 소속이 남아 있어도</b> 먼바다로 보내므로(GROMO-2315) {@code items} 가 비어 있지
 * 않을 수 있다. 앱은 이 값으로 강퇴 안내를 한 번 띄우고 먼바다로 간다.
 *
 * <p><b>불변</b>: {@code currentIslandId} 가 null 이 아니면 {@code lossReason} 은 항상 null 이다 —
 * {@code user_island_contexts_loss_reason_exclusive}(V84) 가 저장 계층에서 같은 것을 강제하고,
 * {@code UserIslandContext#moveTo} 가 이동할 때 사유를 지운다.
 */
public record MyIslandsView(List<IslandSummaryView> items, UUID currentIslandId,
        GroupLeaveReason lossReason) {
}
