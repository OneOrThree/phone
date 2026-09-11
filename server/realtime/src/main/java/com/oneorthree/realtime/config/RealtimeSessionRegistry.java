package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 브로커의 개별 수신 세션을 CONNECT에서 검증한 주체와 연결한다. 토큰은 로그에 남기지 않는다. */
@Slf4j
@Component
public class RealtimeSessionRegistry {

    private final Map<String, ChatPrincipal> principals = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> sockets = new ConcurrentHashMap<>();

    public void opened(WebSocketSession socket) {
        sockets.put(socket.getId(), socket);
    }

    public void closed(String sessionId) {
        sockets.remove(sessionId);
        principals.remove(sessionId);
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
    }
}
