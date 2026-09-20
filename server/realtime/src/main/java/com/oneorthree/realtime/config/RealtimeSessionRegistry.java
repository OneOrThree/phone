package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
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
 * 않는다(창마다 하나씩 꾸준히 쌓으면 걸리지 않는다). 그래서 여기서 두 가지를 따로 막는다 —
 * <b>중복</b>(같은 목적지)과 <b>총량</b>(세션당 구독 수).
 */
@Slf4j
@Component
public class RealtimeSessionRegistry {

    /**
     * 세션 하나가 들 수 있는 구독 수.
     *
     * <p>근거는 <b>계정당 소속 상한</b>이다({@code GroupService.MAX_JOINED_GROUPS} = 10,
     * {@code IslandMovementGuards} 가 같은 값을 되읽는다). 한 섬이 쓰는 목적지는 넷
     * ({@code focus}·{@code rest}·{@code emotes}·채팅 {@code /topic/groups/{id}})이고 개인 큐가 둘
     * ({@code errors}·{@code duplicates})이라, <b>이론상 최대는 10 × 4 + 2 = 42</b> 다. 64 는 거기에
     * 약 50% 여유를 둔 값이다 — 화면 전환 중 옛 구독과 새 구독이 잠깐 겹치는 창을 덮는다.
     *
     * <p>비소속 관전이 열려 있어 한 세션으로 여러 섬을 «둘러보는» 흐름은 소속 상한에 묶이지 않는다.
     * 그 경우에도 <b>UNSUBSCRIBE 가 자리를 돌려주므로</b>, 섬을 떠날 때 구독을 해지하는 정상 클라이언트는
     * 이 상한에 닿지 않는다. 해지 없이 계속 쌓기만 하면 걸리는데, 그건 고쳐야 할 클라이언트 쪽 버그다.
     */
    static final int MAX_SUBSCRIPTIONS_PER_SESSION = 64;

    private final Map<String, ChatPrincipal> principals = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> sockets = new ConcurrentHashMap<>();

    /** {@code sessionId → (subscriptionId → destination)}. UNSUBSCRIBE 가 id 만 주므로 id 로 키를 잡는다. */
    private final Map<String, Map<String, String>> subscriptions = new ConcurrentHashMap<>();

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
     * <p>거절하는 둘은 서로 다른 것을 막는다. <b>중복</b>은 같은 목적지가 여러 번 등록돼 사건 하나가
     * 복제되는 것을, <b>총량</b>은 임의 UUID 로 목적지를 계속 바꿔 레지스트리를 불리는 것을 막는다.
     * 하나만으로는 다른 하나가 그대로 샌다.
     *
     * <p>같은 {@code subscriptionId} 로 같은 목적지를 다시 보내는 것은 <b>재전송</b>으로 보고 통과시킨다 —
     * 그걸 중복으로 세면 프레임 한 번이 늦게 도착한 것만으로 세션이 끊긴다.
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

    /** 이 세션이 들고 있는 구독 수 — 회귀 전용이다. */
    int subscriptionCount(String sessionId) {
        Map<String, String> held = subscriptions.get(sessionId);
        return held == null ? 0 : held.size();
    }

    /** 수신만 하던 앱도 토큰 갱신·재연결을 시작할 수 있게 실제 연결을 끝낸다. */
    public void closeUnauthorized(String sessionId) {
        WebSocketSession socket = sessionId == null ? null : sockets.get(sessionId);
        if (socket == null || !socket.isOpen()) {
            return;
        }
        try {
            socket.close(CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
        } catch (IOException e) {
            // 원 자격과 프레임은 기록하지 않는다. 실패해도 본문은 계속 차단하고 다음 전달에서 재시도한다.
            log.warn("인증 만료 소켓 종료 실패 — reason={}", e.getClass().getSimpleName());
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
