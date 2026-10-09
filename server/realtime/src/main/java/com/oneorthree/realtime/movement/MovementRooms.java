package com.oneorthree.realtime.movement;

import com.oneorthree.realtime.movement.nav.NavGrid;
import com.oneorthree.realtime.movement.nav.NavJsonLoader;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
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
 *
 * <p><b>명령 등록은 전부 같은 섬 키의 {@code ConcurrentHashMap.compute} 안에서 "방이 없으면 만들고, 있으면
 * 그대로 써서 큐(또는 대기 슬롯)에 넣는다"를 한 번에 한다(codex P1, 2246 보완2).</b> {@link #remove} 의
 * {@code computeIfPresent} 가 같은 키를 잠그므로, 방을 꺼내 들고 있다가 그 사이 지워지는 간격이 없다 —
 * {@link #roomFor} 는 그래서 등록 경로로 쓰면 안 되고 테스트·Ticker 전용이다.
 *
 * <p><b>호출자는 이미 소속·인가를 통과한 islandId 만 넘겨야 한다</b>(2246 보완14) — 이 클래스 자체는
 * 임의의 islandId 로 방을 만들어 준다(검사하지 않는다). 그 앞을 지키는 것은 2247 의 STOMP 경계다 —
 * SUBSCRIBE 관문과 SEND 의 구독 보유 검사가 비소속 islandId 를 걸러낸 뒤에야 이 클래스의 메서드가
 * 불린다.
 *
 * <p><b>단일 인스턴스 전제</b>(2246 보완14) — ① 방 상태(이 {@link #rooms} 맵과 그 안의 각
 * {@link RoomRuntime})는 전부 이 JVM 의 메모리일 뿐이다. 인스턴스를 둘로 늘리면 같은 섬이 인스턴스마다
 * 각자 "그 섬의 방"을 따로 만들어, 사실상 같은 섬에 서로 모르는 방이 두 개 생긴다(틱·actor 상태가
 * 갈린다). ② 사용자당 토큰 버킷도 {@code RoomRuntime} 안에 있어 (사용자, 섬, 인스턴스) 조합마다
 * 따로다 — 다중화하면 같은 사용자가 인스턴스를 오가며 버킷을 공유하지 못해 실질 제한이 느슨해질 수
 * 있다. 수평 확장은 이 전제를 깨므로 별도 설계가 필요하다.
 */
@Component
public final class MovementRooms {

    private final NavGrid nav = NavJsonLoader.loadBundled();
    private final Pathfinder pathfinder = new Pathfinder();
    private final RoomRuntime.Listener listener;
    private final Timer pathfindTimer;
    private final ConcurrentHashMap<UUID, RoomRuntime> rooms = new ConcurrentHashMap<>();

    /**
     * {@code movement.pathfind} 는 방마다 생성자로 넘긴다(2246 보완3, {@code movement.tick} 바로 옆) — A*
     * 는 그대로 틱 스레드에서 동기 호출되고(N10, codex P1 반박), 호출 수·소요 nanos 만 센다.
     */
    public MovementRooms(RoomRuntime.Listener listener, MeterRegistry meterRegistry) {
        this.listener = listener;
        this.pathfindTimer = Timer.builder("movement.pathfind")
                .description("방 하나의 A* 경로탐색(pathfinder.find) 1회 호출 시간 — 2250 틱 p99 판단용")
                .register(meterRegistry);
    }

    public void join(UUID islandId, UUID userId, String sessionKey) {
        rooms.compute(islandId, (id, room) -> {
            RoomRuntime r = ensure(id, room);
            r.join(userId, sessionKey);
            return r;
        });
    }

    public void leave(UUID islandId, String sessionKey) {
        rooms.compute(islandId, (id, room) -> {
            RoomRuntime r = ensure(id, room);
            r.leave(sessionKey);
            return r;
        });
    }

    public void accept(UUID islandId, UUID userId, String sessionKey, MoveIntent intent) {
        rooms.compute(islandId, (id, room) -> {
            RoomRuntime r = ensure(id, room);
            r.accept(userId, sessionKey, intent);
            return r;
        });
    }

    /** 2247 이 구독 직후에 쓴다 — 그 세션에만 FullState(ONLY). */
    public void requestFullState(UUID islandId, String sessionKey) {
        rooms.compute(islandId, (id, room) -> {
            RoomRuntime r = ensure(id, room);
            r.requestFullState(sessionKey);
            return r;
        });
    }

    /** 1단계는 레이아웃 버전을 기록만 한다 — 통행 칸은 바뀌지 않는다(N11). */
    public void applyLayout(UUID islandId, long newLayoutRevision) {
        rooms.compute(islandId, (id, room) -> {
            RoomRuntime r = ensure(id, room);
            r.applyLayout(newLayoutRevision);
            return r;
        });
    }

    /**
     * {@code isRemovable()} 을 제거하는 그 순간 한 번 더 확인한다(CAS 식, codex P1) — {@link
     * MovementTicker} 가 "비었다" 고 본 시점과 이 메서드가 실제로 지우는 시점 사이에 다른 스레드의 위
     * 등록 메서드가 큐·대기 슬롯에 명령을 넣었으면, 그 재확인이 실패해 방을 지우지 않는다. {@code
     * computeIfPresent} 의 재계산 함수는 그 키에 대해 원자적으로 돈다 — 등록 메서드들의 {@code compute}
     * 와 같은 키 잠금을 공유해 반쪽짜리로 끼어드는 경우가 없다.
     *
     * <p><b>틱 스레드 전용</b> — {@link MovementTicker} 만 부른다({@link RoomRuntime#isRemovable()} 이
     * {@code actors}·{@code departed} 를 동기화 없이 읽어서다, 2246 보완11). 토큰 버킷은 {@code
     * ConcurrentHashMap} 이라 다른 스레드와 안전하게 겹쳐 읽히지만, 그 대신 방 수명이 버킷 수명과도
     * 묶인다(2246 보완10).
     */
    public void remove(UUID islandId) {
        rooms.computeIfPresent(islandId, (id, room) -> room.isRemovable() ? null : room);
    }

    /** {@link MovementTicker} 가 매 틱마다 돈다. 수정 불가 뷰 — 뒤에서 바뀌는 건 그대로 보인다. */
    public Map<UUID, RoomRuntime> rooms() {
        return Collections.unmodifiableMap(rooms);
    }

    /**
     * 패키지 전용 — 테스트가 방 객체를 직접 들고 상태를 들여다보려고 쓴다(예: {@code fullStateOf()}).
     * <b>등록 경로로 쓰면 안 된다</b> — {@code roomFor(id).join(...)} 처럼 꺼낸 뒤 따로 호출하면 그 사이
     * {@link #remove} 가 끼어들 수 있다(이번에 고친 codex P1 바로 그 패턴). 운영 코드(2247 STOMP 경계)는
     * 위 {@link #join}·{@link #leave}·{@link #accept}·{@link #requestFullState}·{@link #applyLayout} 만
     * 쓴다.
     */
    RoomRuntime roomFor(UUID islandId) {
        return rooms.computeIfAbsent(islandId, id -> ensure(id, null));
    }

    private RoomRuntime ensure(UUID islandId, RoomRuntime room) {
        return room != null ? room
                : new RoomRuntime(islandId, nav, pathfinder, MovementRules.DEFAULT, listener, System::nanoTime,
                        pathfindTimer);
    }
}
