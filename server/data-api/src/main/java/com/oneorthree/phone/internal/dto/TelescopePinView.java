package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 망원경에 섬을 넣은 결과 (GROMO-2268, 섬 외부 계약 §6).
 *
 * @param item    넣은 섬 — 목록에서 보이는 그대로({@code slot=pinned}, {@code pinnedFrom}·{@code pinnedAt} 포함)
 * @param evicted 이 넣기로 밀려난 핀 — 보통은 이 핀이 5번째라 밀려난 가장 오래된 핀이다. 숨어 있던 핀이 되살아나 둘 이상
 *                밀려났으면 그중 가장 최근 것이고, 이미 있던 핀({@code created=false})을 다시 넣을 때도 넘침이 있으면 채워진다.
 *                밀려난 핀이 없으면 null
 * @param created 새 핀이면 true(HTTP 201), 이미 있던 핀을 그대로 돌려줬으면 false(HTTP 200). 공개 응답에는 싣지 않는다 —
 *                Business 가 상태 코드를 고르는 데만 쓴다(그쪽 클라이언트는 상류 상태 코드를 읽지 못한다)
 */
public record TelescopePinView(TelescopeItemView item, Evicted evicted, boolean created) {

    /** 밀려난 핀의 섬 — 앱이 「{name}섬이 망원경에서 빠져요」를 띄운다. */
    public record Evicted(UUID islandId, String name) {
    }
}
