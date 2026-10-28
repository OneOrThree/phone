package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.movement.MoveIntent;
import jakarta.validation.constraints.NotNull;

/**
 * 이동 intent SEND 본문(계약 §2) — {@code {commandSeq, navRevision, goalX, goalY}}.
 *
 * <p>상자 타입 + {@code @NotNull} 인 이유: 원시 타입이면 빠진 필드가 조용히 0 이 되어 «원점으로 걸어가라»가
 * 정상 명령이 된다. 빠진 필드는 {@code INVALID_REQUEST} 로 거절한다. 비유한·범위 밖 값은 여기서 막지 않는다 —
 * {@code RoomRuntime} 이 {@code OUT_OF_RANGE} 로 요청자에게만 돌려준다(N4).
 */
public record MoveIntentRequest(
        @NotNull Long commandSeq,
        @NotNull Integer navRevision,
        @NotNull Double goalX,
        @NotNull Double goalY
) {

    MoveIntent toIntent() {
        return new MoveIntent(commandSeq, navRevision, goalX, goalY);
    }
}
