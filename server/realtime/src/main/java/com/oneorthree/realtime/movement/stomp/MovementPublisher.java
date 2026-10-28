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
import org.springframework.web.socket.CloseStatus;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * {@link RoomRuntime} 의 사건을 세션별 {@link MovementOutbox} 로 나눠 담는다 — 이동 메시지의 유일한 송신 경로다.
 *
 * <p><b>브로커·{@code RealtimeEventEnvelope} 를 쓰지 않는다</b>(N3·N5). {@link Target#ALL} 은 «그 섬
 * outbox 를 가진 세션 전부», {@link Target.Only} 는 그 세션 하나다. 직렬화는 사건당 한 번이고 바이트를 세션마다
 * 나눠 쓴다. 콜백은 틱 스레드에서 오고, outbox 등록·해제는 인바운드 스레드({@link MovementSubscriptionListener})가 한다.
 *
 * <p>측정(2250)은 같은 {@link MeterRegistry} 에 {@code movement.*} 로 둔다 — reliable 덱 깊이
 * ({@code movement.outbox.reliable.depth}), 못 보내고 덮어쓴 Snapshot 수({@code movement.outbox.snapshot.superseded}),
 * 상한 초과로 닫은 세션 수({@code movement.outbox.overflow}), reliable 넘기기 실패로 닫은 세션 수
 * ({@code movement.outbox.send.failed}).
 *
 * <p>다중 인스턴스(GROMO-2339)에서는 방이 다른 인스턴스(소유자)에 있을 수 있다 — 그때 이 클래스는 방 콜백이 아니라
 * {@code MovementCluster} 가 받은 릴레이 프레임을 바이트 입구({@link #deliver}·{@link #deliverSnapshot})로 받는다.
 * 방 콜백({@code RoomRuntime.Listener})은 {@code MovementRelay} 가 받아 Redis 로 내보낸다. outbox 는 늘 이 JVM 의 것이다.
 */
@Slf4j
@Component
public class MovementPublisher implements RoomRuntime.Listener {

    private final ObjectMapper objectMapper;
    private final RealtimeSessionRegistry sessions;
    private final MessageChannel clientOutboundChannel;
    private final DistributionSummary reliableDepth;
    private final Counter supersededSnapshots;
    private final Counter overflows;
    private final Counter sendFailures;

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
        this.sendFailures = Counter.builder("movement.outbox.send.failed")
                .description("reliable 프레임을 아웃바운드 채널에 넘기지 못하거나(false·예외) 핸들러가 처리 중 던져 "
                        + "1011 로 닫은 세션 수 — Snapshot 실패는 버리기만 하고 세지 않는다")
                .register(meterRegistry);
    }

    @Override
    public void onEvent(UUID islandId, MovementEvent event, Target target) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        if (outboxes == null || outboxes.isEmpty()) {
            return;
        }
        byte[] payload = objectMapper.writeValueAsBytes(event);
        if (target instanceof Target.Only only) {
            // 그 세션 한정 FullState(requestFullState)만 송신 게이트를 연다 — 방 큐 FIFO 상 그 세션의 join 뒤라 자기
            // actor 가 들어 있다.
            deliver(islandId, payload, only.sessionKey(), event instanceof MovementEvent.FullState);
            return;
        }
        deliver(islandId, payload, null, false);
    }

    @Override
    public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        if (outboxes == null || outboxes.isEmpty()) {
            return;
        }
        deliverSnapshot(islandId, objectMapper.writeValueAsBytes(snapshot));
    }

    /**
     * 직렬화된 사건 하나를 이 인스턴스의 outbox 로 나눈다 — 로컬 방({@link #onEvent})과 다른 인스턴스 소유자의 릴레이
     * 프레임({@code MovementCluster}, GROMO-2339)이 같은 입구를 쓴다.
     *
     * @param targetSessionId 그 세션 하나만, {@code null} 이면 그 섬 전원
     * @param resync          그 세션 한정 FullState 인가 — 송신 게이트를 여는 유일한 사건. 전원 대상은 늘 false 로 넘긴다
     */
    void deliver(UUID islandId, byte[] payload, String targetSessionId, boolean resync) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        if (outboxes == null || outboxes.isEmpty()) {
            return;
        }
        if (targetSessionId != null) {
            MovementOutbox outbox = outboxes.get(targetSessionId);
            if (outbox != null) {
                enqueue(outbox, payload, resync);
            }
            return;
        }
        for (MovementOutbox outbox : outboxes.values()) {
            // 전원 FullState(남의 입장·퇴장)는 게이트를 열지 않는다 — 이 세션의 join 이 아직 처리되기 전일 수 있다.
            enqueue(outbox, payload, false);
        }
    }

    /** 직렬화된 Snapshot 을 그 섬 outbox 들의 최신 슬롯에 둔다({@link #deliver} 와 같은 이유로 바이트 입구). */
    void deliverSnapshot(UUID islandId, byte[] payload) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        if (outboxes == null) {
            return;
        }
        for (MovementOutbox outbox : outboxes.values()) {
            if (outbox.offerSnapshot(payload)) {
                supersededSnapshots.increment();
            }
        }
    }

    /** 그 섬 소유자가 바뀌었다(GROMO-2339) — 이 인스턴스의 그 섬 outbox 전부 다음 자기 FullState 부터 다시 받는다. */
    void resyncAll(UUID islandId) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        if (outboxes != null) {
            outboxes.values().forEach(MovementOutbox::resync);
        }
    }

    /** 그 세션 하나만 다시 맞춘다 — 다른 인스턴스의 새 세션이 actor 를 가져갔다(SUPERSEDE 프레임, GROMO-2339). */
    void resync(UUID islandId, String sessionId) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        MovementOutbox outbox = outboxes == null ? null : outboxes.get(sessionId);
        if (outbox != null) {
            outbox.resync();
        }
    }

    /** 이 인스턴스에 outbox 가 하나라도 있는 섬들(복사본) — 소유자 감시가 훑는다. */
    Set<UUID> islands() {
        return Set.copyOf(byIsland.keySet());
    }

    private void enqueue(MovementOutbox outbox, byte[] payload, boolean resync) {
        int depth = outbox.enqueueReliable(payload, resync);
        if (depth > 0) {
            reliableDepth.record(depth);
        }
    }

    /**
     * 그 섬에 이 세션의 outbox 를 만든다(인바운드 스레드, 세션 잠금 안). 람다 안에서 블로킹 금지 — 바깥은 세션 잠금,
     * 안쪽 {@code compute} 는 섬 키 잠금이라 둘 다 짧아야 한다.
     */
    MovementOutbox open(UUID islandId, String sessionId, UUID userId) {
        MovementOutbox outbox = new MovementOutbox(clientOutboundChannel, sessionId, userId,
                StompTopics.movementTopic(islandId), StompTopics.movementSnapshotTopic(islandId),
                status -> closeSession(sessionId, status));
        byIsland.compute(islandId, (id, outboxes) -> {
            Map<String, MovementOutbox> held = outboxes != null ? outboxes : new ConcurrentHashMap<>();
            held.put(sessionId, outbox);
            return held;
        });
        return outbox;
    }

    /**
     * 그 섬에서 이 세션의 outbox 를 떼고 닫는다. 비면 섬 항목도 지운다. 람다 안에서 블로킹 금지 — {@code compute} 는
     * 그 섬 키를 잠근 채 돌아 틱 스레드의 사건 배분을 붙잡는다.
     */
    void close(UUID islandId, String sessionId) {
        byIsland.computeIfPresent(islandId, (id, outboxes) -> {
            MovementOutbox outbox = outboxes.remove(sessionId);
            if (outbox != null) {
                outbox.close();
            }
            return outboxes.isEmpty() ? null : outboxes;
        });
    }

    /**
     * 그 섬의 outbox 들(복사본) — 멤버십 재검사·세션 교체가 훑는다. 잠그지 않고 읽기만 한다(블로킹 없음) — 세션
     * 잠금({@code MovementSubscriptionListener} 의 {@code compute}) 안에서 불려도 된다.
     */
    List<MovementOutbox> outboxes(UUID islandId) {
        Map<String, MovementOutbox> outboxes = byIsland.get(islandId);
        return outboxes == null ? List.of() : List.copyOf(outboxes.values());
    }

    /**
     * 송신 워치독 — 이동 스케줄러가 5초마다 부른다(틱 스레드 아님). 완료 통지가 굳은 outbox 를 풀고, 예약된 소켓
     * 종료(큐 초과·reliable 넘기기 실패)를 낸다({@link MovementOutbox#sweep}). 한 outbox 의 예외가 나머지를 막지 않는다.
     */
    void sweep(long nowNanos) {
        for (Map<String, MovementOutbox> outboxes : byIsland.values()) {
            for (MovementOutbox outbox : outboxes.values()) {
                try {
                    outbox.sweep(nowNanos);
                } catch (RuntimeException e) {
                    log.warn("이동 송신 워치독 처리 실패 — reason={}", e.getClass().getSimpleName());
                }
            }
        }
    }

    /**
     * outbox 가 스스로 닫혀 소켓도 닫는다 — 아웃바운드 실행기·워치독 스레드에서 불린다({@link MovementOutbox}), 틱
     * 스레드에서 소켓을 닫지 않는다. 앱은 재연결·재구독으로 FullState 부터 다시 받는다.
     */
    private void closeSession(String sessionId, CloseStatus status) {
        if (MovementOutbox.SEND_FAILED.equals(status)) {
            sendFailures.increment();
            log.warn("이동 reliable 프레임을 아웃바운드 채널에 넘기지 못했다 — 소켓을 {} 로 닫는다", status);
        } else {
            overflows.increment();
            log.warn("이동 송신 큐 상한({}) 초과 — 따라잡을 수 없는 구독자라 소켓을 닫는다", MovementOutbox.RELIABLE_LIMIT);
        }
        sessions.close(sessionId, status);
    }
}
