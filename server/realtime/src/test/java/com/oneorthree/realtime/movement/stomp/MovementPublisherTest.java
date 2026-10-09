package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.movement.MotionState;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.RejectReason;
import com.oneorthree.realtime.movement.Target;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 송신 경계의 직렬화·라우팅 — 앱(2248)이 분기하는 {@code type} 문자열과 필드 이름이 계약 §2 그대로 나가는지.
 *
 * <p>채널은 받는 즉시 완료 통지까지 돌려주는 «빠른 구독자»다({@link MovementOutboundInterceptor} 를 그대로 부른다).
 */
class MovementPublisherTest {

    private final ObjectMapper json = JsonMapper.builder().build();
    private final List<Message<?>> sent = new ArrayList<>();
    private final MovementOutboundInterceptor completion = new MovementOutboundInterceptor();
    private final UUID island = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private MovementPublisher publisher;

    @BeforeEach
    void setUp() {
        publisher = new MovementPublisher(json, new RealtimeSessionRegistry(), new SimpleMeterRegistry(),
                (message, timeout) -> {
                    sent.add(message);
                    completion.afterMessageHandled(message, null, null, null);
                    return true;
                });
        MovementOutbox outbox = publisher.open(island, "s1", user);
        outbox.subscribeMovement("sub-m");
        outbox.subscribeSnapshot("sub-s");
    }

    @Test
    @DisplayName("다섯 메시지의 type·필드 이름이 계약 §2 문자열 그대로 나가고, Snapshot 만 snapshot 토픽으로 간다")
    void everyMessageTypeSerializesWithTheContractShape() {
        MovementEvent.Point start = new MovementEvent.Point(38.5, 45.5);
        MovementEvent.Point next = new MovementEvent.Point(39.5, 44.5);
        // 첫 reliable 은 그 세션 한정 FullState 여야 송신 게이트가 열린다(구독 직후의 requestFullState).
        publisher.onEvent(island, new MovementEvent.FullState(1, 10, 50, 10.989, List.of(
                new MovementEvent.ActorState(user, 38.5, 45.5, MotionState.IDLE, 0, 0, List.of()))),
                Target.only("s1"));
        publisher.onEvent(island, new MovementEvent.PathAccepted(user, 7, 3, 1, 11, start, next, 10.989,
                List.of(next)), Target.ALL);
        publisher.onEvent(island, new MovementEvent.MoveRejected(user, 8, RejectReason.OUT_OF_RANGE, 1, start),
                Target.only("s1"));
        publisher.onEvent(island, new MovementEvent.Arrived(user, 3, 13, next), Target.ALL);
        publisher.onSnapshot(island, new MovementEvent.Snapshot(12, 1, List.of(
                new MovementEvent.Entity(user, 3, 39.21, 44.79, 0, MotionState.MOVING, 7))));

        assertThat(sent).hasSize(5);
        JsonNode fullState = body(0);
        assertThat(fullState.get("type").stringValue()).isEqualTo("FullState");
        assertThat(fieldNames(fullState)).containsExactlyInAnyOrder("type", "navRevision", "serverTick", "tickMs",
                "speed", "actors");
        assertThat(fieldNames(fullState.get("actors").get(0))).containsExactlyInAnyOrder("userId", "x", "y",
                "state", "pathId", "lastCommandSeq", "waypoints");
        assertThat(fullState.get("actors").get(0).get("state").stringValue()).isEqualTo("IDLE");

        JsonNode accepted = body(1);
        assertThat(accepted.get("type").stringValue()).isEqualTo("PathAccepted");
        assertThat(fieldNames(accepted)).containsExactlyInAnyOrder("type", "userId", "commandSeq", "pathId",
                "navRevision", "startTick", "start", "goal", "speed", "waypoints");
        assertThat(fieldNames(accepted.get("waypoints").get(0))).containsExactlyInAnyOrder("x", "y");

        JsonNode rejected = body(2);
        assertThat(rejected.get("type").stringValue()).isEqualTo("MoveRejected");
        assertThat(rejected.get("reason").stringValue()).isEqualTo("OUT_OF_RANGE");
        assertThat(fieldNames(rejected)).containsExactlyInAnyOrder("type", "userId", "commandSeq", "reason",
                "navRevision", "position");

        JsonNode arrived = body(3);
        assertThat(arrived.get("type").stringValue()).isEqualTo("Arrived");
        assertThat(fieldNames(arrived)).containsExactlyInAnyOrder("type", "userId", "pathId", "serverTick",
                "position");

        JsonNode snapshot = body(4);
        assertThat(snapshot.get("type").stringValue()).isEqualTo("Snapshot");
        assertThat(fieldNames(snapshot)).containsExactlyInAnyOrder("type", "serverTick", "navRevision", "entities");
        assertThat(fieldNames(snapshot.get("entities").get(0))).containsExactlyInAnyOrder("userId", "pathId", "x",
                "y", "segmentIndex", "state", "lastCommandSeq");

        assertThat(sent).extracting(m -> SimpMessageHeaderAccessor.getDestination(m.getHeaders())).containsExactly(
                "/topic/islands/" + island + "/movement", "/topic/islands/" + island + "/movement",
                "/topic/islands/" + island + "/movement", "/topic/islands/" + island + "/movement",
                "/topic/islands/" + island + "/movement/snapshot");
    }

    @Test
    @DisplayName("요청자 한정(Only) 사건은 그 세션에만 가고, 같은 섬의 다른 세션은 받지 않는다")
    void onlyTargetReachesThatSessionAlone() {
        MovementOutbox other = publisher.open(island, "s2", UUID.randomUUID());
        other.subscribeMovement("sub-other");
        MovementEvent.FullState state = new MovementEvent.FullState(1, 1, 50, 10.989, List.of());
        publisher.onEvent(island, state, Target.only("s1"));
        publisher.onEvent(island, state, Target.only("s2"));
        sent.clear();

        publisher.onEvent(island, new MovementEvent.MoveRejected(user, 1, RejectReason.STALE_COMMAND, 1,
                new MovementEvent.Point(1, 1)), Target.only("s2"));

        assertThat(sent).hasSize(1);
        assertThat(SimpMessageHeaderAccessor.getSessionId(sent.get(0).getHeaders())).isEqualTo("s2");
        assertThat(SimpMessageHeaderAccessor.getSubscriptionId(sent.get(0).getHeaders())).isEqualTo("sub-other");
    }

    private JsonNode body(int index) {
        return json.readTree((byte[]) sent.get(index).getPayload());
    }

    private static Set<String> fieldNames(JsonNode node) {
        return new LinkedHashSet<>(node.propertyNames());
    }
}
