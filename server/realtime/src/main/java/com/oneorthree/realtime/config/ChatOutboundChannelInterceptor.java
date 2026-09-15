package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 구독 후 집중 시작·토큰 만료에도 채팅 본문을 전달하지 않는다.
 * executor 큐에 넣는 preSend가 아니라 실제 소켓 handler 직전의 beforeHandle에서 검사한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatOutboundChannelInterceptor implements ExecutorChannelInterceptor {

    private static final Pattern GROUP_TOPIC = Pattern.compile("^/topic/groups/([0-9a-f-]{36})$");
    private final RealtimeSessionRegistry sessions;
    private final JwtValidator jwtValidator;
    private final ChatAccessGuard accessGuard;

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        if (SimpMessageHeaderAccessor.getMessageType(message.getHeaders()) != SimpMessageType.MESSAGE) {
            return message;
        }
        String destination = SimpMessageHeaderAccessor.getDestination(message.getHeaders());
        if (destination == null) {
            return null;
        }
        // 새 섬 이벤트는 인가·스냅샷 복구·권한 회수의 후속 구현 전까지 전달 경로도 닫는다.
        if (destination.startsWith("/topic/islands/") || destination.startsWith("/queue/events")) {
            return null;
        }
        Matcher group = GROUP_TOPIC.matcher(destination);
        boolean groupMessage = group.matches();
        boolean duplicate = destination.startsWith("/queue/duplicates")
                || destination.equals("/user/queue/duplicates");
        if (!groupMessage && !duplicate) {
            return message; // 개인 오류 큐는 집중 거절을 알릴 수 있어야 한다.
        }
        String sessionId = SimpMessageHeaderAccessor.getSessionId(message.getHeaders());
        ChatPrincipal principal = sessions.find(sessionId);
        if (principal == null) {
            return null;
        }
        String bearer = principal.bearer();
        String token = bearer != null && bearer.startsWith("Bearer ") ? bearer.substring(7) : null;
        if (jwtValidator.extractUserId(token).filter(principal.userId()::equals).isEmpty()) {
            sessions.closeUnauthorized(sessionId);
            return null;
        }
        try {
            if (groupMessage) {
                accessGuard.requireCanChat(UUID.fromString(group.group(1)), principal.userId(), bearer);
            } else {
                accessGuard.requireNotFocusing(principal.userId());
            }
            return message;
        } catch (UpstreamRejectedCredentialException e) {
            // 자격 자체가 무효다 — 현재 인가 조회를 기다리는 사이 AT 가 만료됐거나, sid/gen 이 없거나, Data 가 401 을 줬다.
            // 프레임만 버리면 수신 전용 앱은 다음 메시지가 올 때까지 만료를 모른 채 갱신·재연결을 시작하지 못한다.
            // 위 JWT 재검증과 같은 규칙으로 실제 소켓을 1008/UNAUTHORIZED 로 닫는다(CLAUDE.md 「만료된 access token」).
            sessions.closeUnauthorized(sessionId);
            return null;
        } catch (RuntimeException e) {
            // 일시 장애(UpstreamUnavailable)·비멤버·집중 중은 프레임만 막고 소켓은 유지한다 — 자격은 여전히 유효하다.
            // 조회 장애도 통과시키지 않는다. 본문·토큰·원격 응답은 기록하지 않는다.
            log.debug("채팅 전달 차단 — reason={}", e.getClass().getSimpleName());
            return null;
        }
    }
}
