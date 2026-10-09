package com.oneorthree.realtime.movement;

import com.oneorthree.realtime.movement.nav.NavGrid;
import com.oneorthree.realtime.movement.nav.NavJsonLoader;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 섬(islandId)별 {@link RoomRuntime} 수명 관리. 방은 처음 쓰일 때 생기고, 비면 {@link MovementTicker} 가 지운다.
 *
 * <p>모든 방이 번들 {@code nav.json} 하나(1단계는 지도가 하나뿐)와 {@link MovementRules#DEFAULT} 를 같이 쓴다
 * — {@link NavGrid} 자체가 "여러 방이 같은 격자를 공유해도 된다"는 불변 구조다(2245 javadoc).
 */
@Component
public final class MovementRooms {

    private final NavGrid nav = NavJsonLoader.loadBundled();
    private final Pathfinder pathfinder = new Pathfinder();
    private final RoomRuntime.Listener listener;
    private final ConcurrentHashMap<UUID, RoomRuntime> rooms = new ConcurrentHashMap<>();

    public MovementRooms(RoomRuntime.Listener listener) {
        this.listener = listener;
    }

    /** 없으면 만들어서 반환 — 생성자 주입된 {@link RoomRuntime.Listener} 하나를 모든 방이 같이 쓴다. */
    public RoomRuntime roomFor(UUID islandId) {
        return rooms.computeIfAbsent(islandId, id -> new RoomRuntime(id, nav, pathfinder, MovementRules.DEFAULT,
                listener));
    }

    /**
     * {@code isRemovable()} 을 제거하는 그 순간 한 번 더 확인한다(CAS 식, codex P1) — {@link
     * MovementTicker} 가 "비었다" 고 본 시점과 이 메서드가 실제로 지우는 시점 사이에 다른 스레드의
     * {@link #roomFor} {@code .join(...)} 이 큐에 들어왔으면, 그 재확인이 실패해 방을 지우지 않는다.
     * {@code computeIfPresent} 의 재계산 함수는 그 키에 대해 원자적으로 돈다.
     */
    public void remove(UUID islandId) {
        rooms.computeIfPresent(islandId, (id, room) -> room.isRemovable() ? null : room);
    }

    /** {@link MovementTicker} 가 매 틱마다 돈다. 수정 불가 뷰 — 뒤에서 바뀌는 건 그대로 보인다. */
    public Map<UUID, RoomRuntime> rooms() {
        return Collections.unmodifiableMap(rooms);
    }
}
