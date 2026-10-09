package com.oneorthree.realtime.movement;

import java.util.List;
import java.util.UUID;

/**
 * 방 안의 actor 하나 — 틱 스레드만 읽고 쓴다(단일 작성자, {@link RoomRuntime} 참고). 그래서 동기화가 없다.
 *
 * <p>세그먼트 안 진행 거리는 따로 들고 있지 않는다 — {@code x, y} 가 그 자체로 "지금 세그먼트 위 어디"를
 * 나타내므로 별도 {@code progress} 필드를 두면 둘이 어긋날 수 있는 불변식이 하나 더 생긴다(ladder: 이미
 * 있는 상태로 충분하면 새 필드를 추가하지 않는다).
 */
final class Actor {

    final UUID userId;
    String sessionKey;
    double x;
    double y;
    MotionState state = MotionState.IDLE;
    /** actor 안에서만 증가 — 0 은 "아직 경로 없음". */
    int pathId;
    /** 지금 걷는 경로의 남은 waypoint 열(출발 셀 제외, cell 중심). 비어 있으면 걸을 게 없다. */
    List<MovementEvent.Point> waypoints = List.of();
    /** 지금 향해 가는 waypoint index — 도착하면 {@code waypoints.size()} 가 돼 "끝" 을 뜻한다. */
    int segmentIndex;
    long lastCommandSeq;
    /** 토큰 버킷(policy §3, N8) — 사용자당 10/s 충전, 순간 20 까지. */
    double tokens;
    long lastRefillTick;

    Actor(UUID userId, String sessionKey, double x, double y, long createdAtTick, double initialTokens) {
        this.userId = userId;
        this.sessionKey = sessionKey;
        this.x = x;
        this.y = y;
        this.lastRefillTick = createdAtTick;
        this.tokens = initialTokens;
    }
}
