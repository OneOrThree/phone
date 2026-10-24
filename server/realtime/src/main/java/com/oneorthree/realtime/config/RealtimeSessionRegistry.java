package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.io.IOException;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 브로커의 개별 수신 세션을 CONNECT에서 검증한 주체와 연결한다. 토큰은 로그에 남기지 않는다.
 *
 * <h2>세션이 들고 있는 구독도 여기서 센다</h2>
 * {@code SimpleBroker} 는 구독을 <b>연결이 끊길 때까지</b> 보관한다. 그래서 인증된 사용자가 STOMP
 * {@code id} 만 바꿔 구독을 반복하면 소켓 하나로 브로커 레지스트리 메모리를 계속 불릴 수 있고, 같은
 * 목적지를 중복 구독하면 사건 하나가 구독 수만큼 복제돼 전송 비용이 증폭된다. 관전 채널
 * ({@code focus}·{@code rest})이 가장 싸게 쌓인다 — 공개라서 상류 조회조차 타지 않기 때문이다.
 *
 * <p>빈도 창({@code lock:chat:emote:sub:*})은 <b>상류 조회</b>를 막지 <b>누적 구독 수</b>를 막지
 * 않는다(창마다 하나씩 꾸준히 쌓으면 걸리지 않는다). 그래서 여기서 세 가지를 따로 막는다 —
 * <b>id 의 목적지 변경</b>(같은 id 로 다른 목적지)·<b>중복</b>(같은 목적지)·<b>총량</b>(세션당 구독 수).
 */
@Slf4j
@Component
public class RealtimeSessionRegistry implements MeterBinder {

    /**
     * 세션 하나가 들 수 있는 구독 수.
     *
     * <p>근거는 <b>계정당 소속 상한</b>이다({@code GroupService.MAX_JOINED_GROUPS} = 10,
     * {@code IslandMovementGuards} 가 같은 값을 되읽는다). 한 섬이 쓰는 목적지는 일곱
     * ({@code focus}·{@code rest}·{@code emotes}·{@code events}(GROMO-2302)·채팅 {@code /topic/groups/{id}}·이동
     * {@code movement}·{@code movement/snapshot}, GROMO-2247)이고 개인 큐가 둘({@code errors}·{@code duplicates})이라,
     * 섬 쪽 최대는 10 × 7 + 2 = 72 이고, 바다가 세션당 둘({@code /user/queue/sea}·{@code /topic/sea/rooms/{roomId}},
     * GROMO-2300)을 더해 <b>이론상 최대는 74</b> 다. 96 은 거기에 약 30% 여유를 둔 값이다 — 화면 전환 중 옛 구독과
     * 새 구독이 잠깐 겹치는 창을 덮는다.
     *
     * <p>비소속 관전이 열려 있어 한 세션으로 여러 섬을 «둘러보는» 흐름은 소속 상한에 묶이지 않는다.
     * 그 경우에도 <b>UNSUBSCRIBE 가 자리를 돌려주므로</b>, 섬을 떠날 때 구독을 해지하는 정상 클라이언트는
     * 이 상한에 닿지 않는다. 해지 없이 계속 쌓기만 하면 걸리는데, 그건 고쳐야 할 클라이언트 쪽 버그다.
     */
    static final int MAX_SUBSCRIPTIONS_PER_SESSION = 96;

    private final Map<String, ChatPrincipal> principals = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> sockets = new ConcurrentHashMap<>();

    /** {@code sessionId → (subscriptionId → destination)}. UNSUBSCRIBE 가 id 만 주므로 id 로 키를 잡는다. */
    private final Map<String, Map<String, String>> subscriptions = new ConcurrentHashMap<>();

    /** 연결·인증·구독을 구분해 연결 폭주와 구독 누적을 관측한다. 사용자별 라벨은 만들지 않는다. */
    @Override
    public void bindTo(MeterRegistry registry) {
        Gauge.builder("realtime.websocket.sessions", sockets, Map::size).register(registry);
        Gauge.builder("realtime.stomp.sessions", principals, Map::size).register(registry);
        Gauge.builder("realtime.stomp.subscriptions", this, RealtimeSessionRegistry::totalSubscriptions)
                .register(registry);
    }

    private int totalSubscriptions() {
        int total = 0;
        for (Map<String, String> held : subscriptions.values()) {
            synchronized (held) {
                total += held.size();
            }
        }
        return total;
    }

    public void opened(WebSocketSession socket) {
        sockets.put(socket.getId(), socket);
    }

    public void closed(String sessionId) {
        sockets.remove(sessionId);
        principals.remove(sessionId);
        subscriptions.remove(sessionId);
    }

    /**
     * 이 세션에 구독 하나를 더할 수 있는지 — 더할 수 있으면 기록하고 {@code true}.
     *
     * <p>거절하는 셋은 서로 다른 것을 막는다. <b>id 의 목적지 변경</b>은 브로커 레지스트리와 이 기록이 어긋나는
     * 것을, <b>중복</b>은 같은 목적지가 여러 번 등록돼 사건 하나가 복제되는 것을, <b>총량</b>은 임의 UUID 로
     * 목적지를 계속 바꿔 레지스트리를 불리는 것을 막는다. 하나만으로는 나머지가 그대로 샌다.
     *
     * <p>같은 {@code subscriptionId} 로 같은 목적지를 다시 보내는 것은 <b>재전송</b>으로 보고 통과시킨다 —
     * 그걸 중복으로 세면 프레임 한 번이 늦게 도착한 것만으로 세션이 끊긴다. 같은 id 로 <b>다른</b> 목적지를
     * 보내는 것은 거절한다 — id 의 목적지는 처음 등록된 값에 고정되고, 바꾸려면 UNSUBSCRIBE 뒤 새로 구독한다.
     *
     * @return 세션을 추적할 수 없으면({@code sessionId}·{@code subscriptionId} 가 없으면) {@code true} —
     *         정상 STOMP 클라이언트에는 둘 다 있고, 없는 프레임은 관문의 다른 검사가 막는다
     */
    public boolean subscribe(String sessionId, String subscriptionId, String destination) {
        if (sessionId == null || subscriptionId == null || destination == null) {
            return true;
        }
        Map<String, String> held = subscriptions.computeIfAbsent(sessionId, key -> new HashMap<>());
        synchronized (held) {
            if (destination.equals(held.get(subscriptionId))) {
                return true;
            }
            // 브로커 레지스트리는 같은 id 의 두 번째 등록을 putIfAbsent 로 무시해 옛 목적지가 남는다. 여기서 바꿔 끼우면
            // 뒤이은 다른 id 의 같은 목적지 구독이 중복 검사를 통과해 같은 사건을 두 번 전송하게 된다(GROMO-2210).
            if (held.containsKey(subscriptionId)) {
                return false;
            }
            if (held.containsValue(destination) || held.size() >= MAX_SUBSCRIPTIONS_PER_SESSION) {
                return false;
            }
            held.put(subscriptionId, destination);
            return true;
        }
    }

    /** UNSUBSCRIBE — 자리를 돌려준다. 이게 없으면 같은 섬에 다시 들어올 때 중복으로 걸린다. */
    public void unsubscribe(String sessionId, String subscriptionId) {
        if (sessionId == null || subscriptionId == null) {
            return;
        }
        Map<String, String> held = subscriptions.get(sessionId);
        if (held == null) {
            return;
        }
        synchronized (held) {
            held.remove(subscriptionId);
        }
    }

    /**
     * 이 목적지들의 구독 기록을 id 와 무관하게 지운다 — 이동 강퇴가 그 세션×섬 두 토픽의 «판정받은 구독»을 무효화할 때
     * 쓴다(GROMO-2247). 남겨 두면 intent 관문이 통과시키고, 같은 id 의 재구독이 재전송으로 읽힌다.
     */
    public void unsubscribeDestinations(String sessionId, Collection<String> destinations) {
        Map<String, String> held = sessionId == null ? null : subscriptions.get(sessionId);
        if (held == null) {
            return;
        }
        synchronized (held) {
            held.values().removeIf(destinations::contains);
        }
    }

    /** 이 세션이 들고 있는 구독 수 — 회귀 전용이다. */
    int subscriptionCount(String sessionId) {
        Map<String, String> held = subscriptions.get(sessionId);
        return held == null ? 0 : held.size();
    }

    /**
     * 이 세션이 그 목적지에 쓴 STOMP 구독 id — 구독하지 않았으면 {@code null}.
     *
     * <p>이동 intent 의 SEND 관문이 「그 섬 movement 를 구독 중인가」를 인메모리로 보는 데 쓴다(GROMO-2247, N2).
     */
    public String subscriptionIdOf(String sessionId, String destination) {
        Map<String, String> held = sessionId == null || destination == null ? null : subscriptions.get(sessionId);
        if (held == null) {
            return null;
        }
        synchronized (held) {
            for (Map.Entry<String, String> entry : held.entrySet()) {
                if (destination.equals(entry.getValue())) {
                    return entry.getKey();
                }
            }
            return null;
        }
    }

    /**
     * 이 세션의 그 구독 id 가 가리키는 목적지 — 없으면 {@code null}. UNSUBSCRIBE 는 id 만 주므로, 해지가 바다 방
     * 퇴장인지 판정하려면 지우기 <b>전에</b> 되찾아야 한다(GROMO-2300).
     */
    public String destinationOf(String sessionId, String subscriptionId) {
        Map<String, String> held = sessionId == null || subscriptionId == null ? null : subscriptions.get(sessionId);
        if (held == null) {
            return null;
        }
        synchronized (held) {
            return held.get(subscriptionId);
        }
    }

    /**
     * 같은 사용자의 <b>다른</b> 세션이 이 JVM 에 붙어 있는가 — 소켓 종료가 바다 방 퇴장인지(마지막 세션일 때만) 가른다.
     *
     * <p>ponytail: 세션 전체를 훑는다(O(세션 수)). 종료마다 한 번이라 지금은 싸다 — 커지면 userId → 세션 수 색인으로.
     */
    public boolean hasOtherSession(UUID userId, String exceptSessionId) {
        return principals.entrySet().stream().anyMatch(entry -> !entry.getKey().equals(exceptSessionId)
                && userId.equals(entry.getValue().userId()));
    }

    /** 이 JVM 에 붙은 그 사용자의 세션 id 전부 — 사용자 단위 통지를 세션마다 따로 보내는 데 쓴다(GROMO-2300). */
    public List<String> sessionIdsOf(UUID userId) {
        return principals.entrySet().stream().filter(entry -> userId.equals(entry.getValue().userId()))
                .map(Map.Entry::getKey).toList();
    }

    /**
     * 소켓이 아직 {@link #closed} 되지 않았는가. <b>한 번 false 가 되면 그 세션 id 로는 다시 true 가 되지 않는다</b>
     * — 소켓 종료 뒤에도 순서 보존 큐에 남아 늦게 처리되는 프레임을 가려내는 데 쓴다(이동 방 입장, GROMO-2247).
     */
    public boolean isConnected(String sessionId) {
        return sessionId != null && sockets.containsKey(sessionId);
    }

    /** 수신만 하던 앱도 토큰 갱신·재연결을 시작할 수 있게 실제 연결을 끝낸다. */
    public void closeUnauthorized(String sessionId) {
        close(sessionId, CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
    }

    /**
     * 실제 연결을 끝낸다 — 상태의 {@code reason} 이 앱이 볼 수 있는 기계용 사유다(1008 {@code UNAUTHORIZED}·
     * {@code SESSION_REVOKED}·{@code MOVEMENT_BACKPRESSURE}·{@code OUTBOUND_QUEUE_FULL},
     * 1011 {@code MEMBERSHIP_UNVERIFIED}·
     * {@code MOVEMENT_SEND_FAILED}). 던지지 않는다 — 부르는 쪽이 송신·재검사 스레드라, 여기서 새는 예외가 그 스레드의 다음
     * 일을 끊으면 안 된다.
     *
     * @return 닫았거나 닫을 열린 소켓이 없으면 {@code true}, 종료가 실패해 소켓이 열린 채 남았으면 {@code false} — 다시
     *         시도할지는 부르는 쪽이 정한다(전달 직전 재검사 경로는 다음 프레임이 같은 판정으로 다시 닫는다, 송신 예산은 종료
     *         예약을 풀어 다음 거부에서 다시 예약한다). 반환값을 무시해도 된다.
     */
    public boolean close(String sessionId, CloseStatus status) {
        WebSocketSession socket = sessionId == null ? null : sockets.get(sessionId);
        if (socket == null || !socket.isOpen()) {
            return true;
        }
        try {
            socket.close(status);
            return true;
        } catch (IOException | RuntimeException e) {
            // 원 자격과 프레임은 기록하지 않는다.
            log.warn("소켓 종료 실패 — status={} cause={}", status, e.getClass().getSimpleName());
            return false;
        }
    }

    public void register(String sessionId, ChatPrincipal principal) {
        if (sessionId != null) {
            principals.put(sessionId, principal);
        }
    }

    public ChatPrincipal find(String sessionId) {
        return sessionId == null ? null : principals.get(sessionId);
    }

    @EventListener
    public void disconnected(SessionDisconnectEvent event) {
        principals.remove(event.getSessionId());
        subscriptions.remove(event.getSessionId());
    }
}
