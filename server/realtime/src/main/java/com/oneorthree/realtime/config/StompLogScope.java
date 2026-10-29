package com.oneorthree.realtime.config;

import com.oneorthree.realtime.logging.LogContext;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;

import java.security.Principal;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.UUID;

/**
 * STOMP 수신 프레임마다 로그 문맥을 연다 (GROMO-2559) — {@code request_id}(프레임마다 새 UUID)와 인증된 {@code user_id} 를
 * 설치하고 되돌린다. 세션 전체를 한 문맥으로 묶지 않는다. 채팅 발신이 내는 팬아웃의 원인 요청 번호가 이 {@code request_id} 다
 * (계약 §2.2 승격).
 *
 * <p>수신 인터셉터 <b>맨 앞</b>이라 뒤 인터셉터의 로그도 이 값을 달고, 프레임을 버리지 않는다(null 을 돌려주지 않는다) — 거절은
 * 종전 인터셉터들이 그대로 한다.
 *
 * <p><b>관문({@code preSend}~{@code afterSendCompletion})과 처리({@code beforeHandle}~{@code afterMessageHandled}) 둘 다
 * 연다</b>(GROMO-2581). 관문 거절(ERROR 프레임) 로그도 그 프레임의 {@code request_id} 를 달고, ERROR 프레임을 넘기는 아웃바운드
 * 작업도 실행기 장식기로 같은 값을 물려받는다. 관문에서 만든 값은 내부 헤더({@link #REQUEST_ID_HEADER})로 처리 단계에 넘겨 한
 * 프레임이 한 값을 쓴다 — 헤더를 못 다는(불변) 메시지면 처리 단계가 새 값을 만든다.
 *
 * <p>순서 보존({@code setPreserveReceiveOrder})의 Spring 콜백은 {@code afterMessageHandled} 가 이것보다 나중에 돌아, 같은 실행
 * 스레드에서 다음 프레임의 {@code preSend} 를 부른다. 그때 앞 프레임의 처리 문맥은 이미 닫혔고, 다음 프레임은 자기 값을 새로
 * 설치한다({@code user_id} 도 먼저 내려 두고 다시 단다).
 */
final class StompLogScope implements ExecutorChannelInterceptor {

    /** 관문의 {@code request_id} 를 처리 단계로 넘기는 내부 헤더 — STOMP native 헤더가 아니라 클라이언트가 실을 수 없다. */
    static final String REQUEST_ID_HEADER = "realtimeLogRequestId";

    /** 열린 scope — 수신·송신 쌍은 같은 스레드에서 중첩(LIFO)으로만 열리고 닫힌다. */
    private final ThreadLocal<Deque<LogContext>> open = ThreadLocal.withInitial(ArrayDeque::new);

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        String requestId = UUID.randomUUID().toString();
        SimpMessageHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, SimpMessageHeaderAccessor.class);
        if (accessor != null && accessor.isMutable()) {
            accessor.setHeader(REQUEST_ID_HEADER, requestId);
        }
        open.get().push(frame(requestId, message));
        return message;
    }

    @Override
    public void afterSendCompletion(Message<?> message, MessageChannel channel, boolean sent, Exception ex) {
        close();
    }

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        Object carried = message.getHeaders().get(REQUEST_ID_HEADER);
        open.get().push(frame(carried instanceof String id ? id : UUID.randomUUID().toString(), message));
        return message;
    }

    @Override
    public void afterMessageHandled(Message<?> message, MessageChannel channel, MessageHandler handler,
            Exception ex) {
        close();
    }

    /** 이 프레임의 두 키 — {@code user_id} 는 먼저 내려 둔다(주체가 없는 CONNECT 관문에 앞 프레임의 사용자가 남지 않게). */
    private static LogContext frame(String requestId, Message<?> message) {
        return LogContext.open().remove(LogContext.USER_ID)
                .put(LogContext.REQUEST_ID, requestId)
                .put(LogContext.USER_ID, userOf(message));
    }

    private void close() {
        Deque<LogContext> scopes = open.get();
        LogContext scope = scopes.poll();
        if (scope != null) {
            scope.close();
        }
        if (scopes.isEmpty()) {
            open.remove();
        }
    }

    /** CONNECT 는 관문이 preSend 에서 붙인 주체, 이후 프레임은 세션 주체({@code ChatPrincipal} 의 이름 = userId). */
    private static String userOf(Message<?> message) {
        Principal user = SimpMessageHeaderAccessor.getUser(message.getHeaders());
        return user == null ? null : user.getName();
    }
}
