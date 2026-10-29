package com.oneorthree.realtime.config;

import com.oneorthree.realtime.logging.LogContext;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.support.ExecutorChannelInterceptor;

import java.security.Principal;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.UUID;

/**
 * STOMP 수신 프레임마다 로그 문맥을 연다 (GROMO-2559) — {@code request_id}(프레임마다 새 UUID)와 인증된 {@code user_id} 를
 * 실행 스레드의 {@code beforeHandle} 에서 설치하고 {@code afterMessageHandled} 에서 되돌린다. 세션 전체를 한 문맥으로 묶지 않는다.
 * 채팅 발신이 내는 팬아웃의 원인 요청 번호가 이 {@code request_id} 다(계약 §2.2 승격).
 *
 * <p>수신 인터셉터 <b>맨 앞</b>이라 뒤 인터셉터의 {@code beforeHandle} 로그도 이 값을 달고, 프레임을 버리지 않는다(null 을 돌려주지
 * 않는다) — 거절은 종전 인터셉터들이 그대로 한다.
 *
 * <p><b>다음 프레임의 {@code preSend} 동안은 내려 둔다.</b> 순서 보존({@code setPreserveReceiveOrder})의 Spring 콜백은 실행기
 * 인터셉터 목록 «맨 뒤»에 붙어 {@code afterMessageHandled} 가 이것보다 먼저 돌고, 같은 스레드에서 다음 프레임을 보낸다. 그대로 두면
 * 다음 프레임의 관문({@code preSend}) 로그가 앞 프레임의 {@code request_id} 를 단다.
 */
final class StompLogScope implements ExecutorChannelInterceptor {

    /** 열린 scope — 수신·송신 쌍은 같은 스레드에서 중첩(LIFO)으로만 열리고 닫힌다. */
    private final ThreadLocal<Deque<LogContext>> open = ThreadLocal.withInitial(ArrayDeque::new);

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        open.get().push(LogContext.open().remove(LogContext.REQUEST_ID).remove(LogContext.USER_ID));
        return message;
    }

    @Override
    public void afterSendCompletion(Message<?> message, MessageChannel channel, boolean sent, Exception ex) {
        close();
    }

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        open.get().push(LogContext.open()
                .put(LogContext.REQUEST_ID, UUID.randomUUID().toString())
                .put(LogContext.USER_ID, userOf(message)));
        return message;
    }

    @Override
    public void afterMessageHandled(Message<?> message, MessageChannel channel, MessageHandler handler,
            Exception ex) {
        close();
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
