package com.oneorthree.realtime.movement;

import java.util.Objects;

/** {@link RoomRuntime.Listener#onEvent} 의 수신 대상 — 방 전원 또는 세션 하나(예: MoveRejected, N4). */
public sealed interface Target {

    /** 방의 모든 세션. 매번 새로 만들 필요 없이 이 인스턴스를 쓴다. */
    Target ALL = new All();

    /** 그 세션 하나만. */
    static Target only(String sessionKey) {
        return new Only(sessionKey);
    }

    record All() implements Target {
    }

    record Only(String sessionKey) implements Target {
        public Only {
            Objects.requireNonNull(sessionKey, "sessionKey");
        }
    }
}
