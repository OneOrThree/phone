package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 브로커의 개별 수신 세션을 CONNECT에서 검증한 주체와 연결한다. 토큰은 로그에 남기지 않는다. */
@Component
public class RealtimeSessionRegistry {

    private final Map<String, ChatPrincipal> principals = new ConcurrentHashMap<>();

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
