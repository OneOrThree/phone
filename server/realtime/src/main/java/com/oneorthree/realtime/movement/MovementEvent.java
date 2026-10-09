package com.oneorthree.realtime.movement;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * 서버 → 클라이언트 이동 메시지(계약 §2). STOMP 전송은 2247 이 배선하고, 여기서는 순수 데이터만 정의한다.
 *
 * <p>{@code type} 은 계약 JSON 의 판별자다. {@link FullState}·{@link Snapshot} 은 그 값을 레코드 컴포넌트로
 * 받고(테스트가 값을 바로 비교할 수 있다), 나머지 셋은 {@link JsonProperty} 를 붙인 {@code type()} 메서드로
 * 고정 문자열을 얹는다 — 둘 다 추가 Jackson 설정 없이 계약과 같은 이름의 JSON 필드가 나온다.
 */
public sealed interface MovementEvent {

    /** 메시지 판별자 — 계약 §2 의 {@code type} 필드. */
    String type();

    /** 월드 좌표 한 점(계약 §0 — 실수, 소수 2자리). */
    record Point(double x, double y) {
    }

    /**
     * {@link FullState} 의 actor 한 명. {@code waypoints} 는 남은 경로 — MOVING 이면 지금 segmentIndex
     * 부터 끝까지(현재 위치는 제외), IDLE 이면 빈 리스트다(계약 §2 변경, N34). 입장 당시 이미 걷고 있던
     * 주민의 남은 경로를 몰라 앱이 스냅샷을 못 받던 결함을 고친다(2246 보완1) — 앱은
     * {@code [현재 위치, ...waypoints]} 로 등록한다.
     */
    record ActorState(UUID userId, double x, double y, MotionState state, int pathId, long lastCommandSeq,
            List<Point> waypoints) {
        public ActorState {
            Objects.requireNonNull(userId, "userId");
            Objects.requireNonNull(state, "state");
            waypoints = List.copyOf(waypoints);
        }
    }

    /** {@link Snapshot} 의 entity 한 명. */
    record Entity(UUID userId, int pathId, double x, double y, int segmentIndex, MotionState state,
            long lastCommandSeq) {
        public Entity {
            Objects.requireNonNull(userId, "userId");
            Objects.requireNonNull(state, "state");
        }
    }

    /** 구독 직후 1회 + actor 집합이 바뀔 때마다 방 전원(N6). 앱은 actor 목록을 통째로 교체한다. */
    record FullState(String type, int navRevision, long serverTick, long tickMs, double speed,
            List<ActorState> actors) implements MovementEvent {

        public FullState(int navRevision, long serverTick, long tickMs, double speed, List<ActorState> actors) {
            this("FullState", navRevision, serverTick, tickMs, speed, actors);
        }

        public FullState {
            Objects.requireNonNull(type, "type");
            actors = List.copyOf(actors);
        }
    }

    /** intent 가 받아들여져 경로가 확정됐다 — waypoints 는 출발 셀 제외 셀 중심 열. 방 전원. */
    record PathAccepted(UUID userId, long commandSeq, int pathId, int navRevision, long startTick, Point start,
            Point goal, double speed, List<Point> waypoints) implements MovementEvent {

        public PathAccepted {
            Objects.requireNonNull(userId, "userId");
            Objects.requireNonNull(start, "start");
            Objects.requireNonNull(goal, "goal");
            waypoints = List.copyOf(waypoints);
        }

        @Override
        @JsonProperty("type")
        public String type() {
            return "PathAccepted";
        }
    }

    /** intent 거절 — 요청자 세션에만(N4). {@code reason} 은 {@link RejectReason} 의 이름 문자열. */
    record MoveRejected(UUID userId, long commandSeq, String reason, int navRevision, Point position)
            implements MovementEvent {

        public MoveRejected(UUID userId, long commandSeq, RejectReason reason, int navRevision, Point position) {
            this(userId, commandSeq, reason.name(), navRevision, position);
        }

        public MoveRejected {
            Objects.requireNonNull(userId, "userId");
            Objects.requireNonNull(reason, "reason");
            Objects.requireNonNull(position, "position");
        }

        @Override
        @JsonProperty("type")
        public String type() {
            return "MoveRejected";
        }
    }

    /** 경로 도착 — 방 전원, 경로당 1회. */
    record Arrived(UUID userId, int pathId, long serverTick, Point position) implements MovementEvent {

        public Arrived {
            Objects.requireNonNull(userId, "userId");
            Objects.requireNonNull(position, "position");
        }

        @Override
        @JsonProperty("type")
        public String type() {
            return "Arrived";
        }
    }

    /** 20Hz 이하 위치 보간용 — MOVING 이 있는 틱에만 + 멈춘 뒤 1회(N15). 방 전원 포함. */
    record Snapshot(String type, long serverTick, int navRevision, List<Entity> entities) implements MovementEvent {

        public Snapshot(long serverTick, int navRevision, List<Entity> entities) {
            this("Snapshot", serverTick, navRevision, entities);
        }

        public Snapshot {
            Objects.requireNonNull(type, "type");
            entities = List.copyOf(entities);
        }
    }
}
