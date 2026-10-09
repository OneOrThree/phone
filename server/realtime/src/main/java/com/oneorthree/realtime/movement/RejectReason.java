package com.oneorthree.realtime.movement;

/** {@link MovementEvent.MoveRejected} 의 거절 사유 — JSON 은 {@link Enum#name()} 문자열. */
public enum RejectReason {
    OUT_OF_RANGE, NO_REACHABLE_GOAL, STALE_COMMAND, NAV_REVISION_MISMATCH
}
