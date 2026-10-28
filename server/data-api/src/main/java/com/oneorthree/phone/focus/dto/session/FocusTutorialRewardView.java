package com.oneorthree.phone.focus.dto.session;

import java.util.UUID;

/** granted는 이번 세션의 지급 확정(재요청 포함), pending은 5초 미만, unavailable은 다른 세션에서 수령. */
public record FocusTutorialRewardView(UUID sessionId, String status) {
}
