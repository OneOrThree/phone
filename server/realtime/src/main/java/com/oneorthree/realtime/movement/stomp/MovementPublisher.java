package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompTopics;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.RoomRuntime;
import com.oneorthree.realtime.movement.Target;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.MessageChannel;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * {@link RoomRuntime} 의 사건을 세션별 {@link MovementOutbox} 로 나눠 담는다 — 이동 메시지의 유일한 송신 경로다.
 *
 * <p><b>브로커·{@code RealtimeEventEnvelope}·Redis 팬아웃을 쓰지 않는다</b>(N3·N5). {@link Target#ALL} 은 «그 섬
 * outbox 를 가진 세션 전부», {@link Target.Only} 는 그 세션 하나다. 직렬화는 사건당 한 번이고 바이트를 세션마다
 * 나눠 쓴다. 콜백은 틱 스레드에서 오고, outbox 등록·해제는 인바운드 스레드({@link MovementSubscriptionListener})가 한다.
 *
 * <p>측정(2250)은 같은 {@link MeterRegistry} 에 {@code movement.*} 로 둔다 — reliable 덱 깊이
 * ({@code movement.outbox.reliable.depth}), 못 보내고 덮어쓴 Snapshot 수({@code movement.outbox.snapshot.superseded}),
 * 상한 초과로 닫은 세션 수({@code movement.outbox.overflow}).
 *
 * <p>ponytail: 단일 인스턴스 가정(N5) — 방·outbox 가 이 JVM 메모리에만 있다. 다중 인스턴스 소유권은 2단계.
 */
@Slf4j
@Component
public class MovementPublisher implements RoomRuntime.Listener {

    private static final String BACKPRESSURE = "MOVEMENT_BACKPRESSURE";

    private final ObjectMapper objectMapper;
    private final RealtimeSessionRegistry sessions;
    private final MessageChannel clientOutboundChannel;
    private final DistributionSummary reliableDepth;
    private final Counter supersededSnapshots;
    private final Counter overflows;

    /** islandId → (sessionId → outbox). 안쪽 맵의 추가·제거는 바깥 맵의 {@code compute} 안에서만 한다. */
    private final ConcurrentHashMap<UUID, Map<String, MovementOutbox>> byIsland = new ConcurrentHashMap<>();

    /**
     * {@code clientOutboundChannel} 을 <b>늦게</b> 받는다 — 그 채널을 만드는 설정({@code WebSocketConfig})이 이동
     * 구독 처리기를 거쳐 이 빈을 필요로 하는 순환이라서다({@code WebSocketConfig} 가 같은 채널을 받는 방식과 같다).
     */
    public MovementPublisher(ObjectMapper objectMapper, RealtimeSessionRegistry sessions, MeterRegistry meterRegistry,
            @Lazy @Qualifier("clientOutboundChannel") MessageChannel clientOutboundChannel) {
        this.objectMapper = objectMapper;
        this.sessions = sessions;
        this.clientOutboundChannel = clientOutboundChannel;
        this.reliableDepth = DistributionSummary.builder("movement.outbox.reliable.depth")
                .description("이동 reliable 사건을 세션 송신 큐에 넣은 직후의 큐 깊이 — 2250 송신 큐 측정용")
                .register(meterRegistry);
        this.supersededSnapshots = Counter.builder("movement.outbox.snapshot.superseded")
                .description("보내기 전에 더 새 Snapshot 으로 덮어쓴 횟수(세션별 최신만, N3)")
                .register(meterRegistry);
        this.overflows = Counter.builder("movement.outbox.overflow")
                .description("reliable 송신 큐 상한을 넘겨 소켓을 닫은 세션 수")
                .register(meterRegistry);
    }

    @Override
    public void onEvent(UUID islandId, MovementEvent event, Target target) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        if (outboxes == null || outboxes.isEmpty()) {
            return;
        }
        byte[] payload = objectMapper.writeValueAsBytes(event);
        boolean fullState = event instanceof MovementEvent.FullState;
        if (target instanceof Target.Only only) {
            MovementOutbox outbox = outboxes.get(only.sessionKey());
            if (outbox != null) {
                enqueue(outbox, payload, fullState);
            }
            return;
        }
        for (MovementOutbox outbox : outboxes.values()) {
            enqueue(outbox, payload, fullState);
        }
    }

    @Override
    public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        if (outboxes == null || outboxes.isEmpty()) {
            return;
        }
        byte[] payload = objectMapper.writeValueAsBytes(snapshot);
        for (MovementOutbox outbox : outboxes.values()) {
            if (outbox.offerSnapshot(payload)) {
                supersededSnapshots.increment();
            }
        }
    }

    private void enqueue(MovementOutbox outbox, byte[] payload, boolean fullState) {
        int depth = outbox.enqueueReliable(payload, fullState);
        if (depth > 0) {
            reliableDepth.record(depth);
        }
    }

    /** 그 섬에 이 세션의 outbox 를 만든다(인바운드 스레드, 세션 잠금 안). */
    MovementOutbox open(UUID islandId, String sessionId, UUID userId) {
        MovementOutbox outbox = new MovementOutbox(clientOutboundChannel, sessionId, userId,
                StompTopics.movementTopic(islandId), StompTopics.movementSnapshotTopic(islandId),
                () -> closeForBackpressure(sessionId));
        byIsland.compute(islandId, (id, outboxes) -> {
            Map<String, MovementOutbox> held = outboxes != null ? outboxes : new ConcurrentHashMap<>();
            held.put(sessionId, outbox);
            return held;
        });
        return outbox;
    }

    /** 그 섬에서 이 세션의 outbox 를 떼고 닫는다. 비면 섬 항목도 지운다. */
    void close(UUID islandId, String sessionId) {
        byIsland.computeIfPresent(islandId, (id, outboxes) -> {
            MovementOutbox outbox = outboxes.remove(sessionId);
            if (outbox != null) {
                outbox.close();
            }
            return outboxes.isEmpty() ? null : outboxes;
        });
    }

    /** 그 섬의 outbox 들(복사본) — 멤버십 재검사·세션 교체가 훑는다. */
    List<MovementOutbox> outboxes(UUID islandId) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        return outboxes == null ? List.of() : List.copyOf(outboxes.values());
    }

    /** 아웃바운드 실행기 스레드에서 불린다({@link MovementOutbox#onSent}) — 틱 스레드에서 소켓을 닫지 않는다. */
    private void closeForBackpressure(String sessionId) {
        overflows.increment();
        log.warn("이동 송신 큐 상한({}) 초과 — 따라잡을 수 없는 구독자라 소켓을 닫는다", MovementOutbox.RELIABLE_LIMIT);
        sessions.close(sessionId, BACKPRESSURE);
    }
}
