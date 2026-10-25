package com.oneorthree.realtime.config;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.MessageHeaders;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.broker.AbstractBrokerMessageHandler;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;

import java.util.Map;

/**
 * 끝난 STOMP 세션의 늦은 프레임이 브로커 상태를 되살리지 못하게 한다.
 *
 * <p>소켓 종료 때 Spring 이 만드는 DISCONNECT({@code StompSubProtocolHandler.afterSessionEnded})는 세션별 순서 보존 큐
 * ({@code OrderedMessageChannelDecorator})를 거치지 않고 수신 채널로 바로 간다. 수신 큐가 차 있으면
 * {@link InboundCallerRunsPolicy} 가 그것을 종료 스레드에서 곧바로 처리해, 실행기 큐에 아직 남은 그 세션의 CONNECT 를
 * 추월한다. 뒤늦게 돈 CONNECT 는 {@code SimpleBrokerMessageHandler} 에 닫힌 세션을 다시 등록하고, {@code heart-beat:0,0}
 * 세션은 지울 무활동 타임아웃도 없어 영구히 남는다. 순서 보존 큐가 그 뒤에 풀어 주는 SUBSCRIBE 도 구독 레지스트리에 남는다.
 *
 * <p>종료 DISCONNECT 를 세션 큐 뒤로 미루는 대신 끝났다고 표시하고 늦은 프레임을 버린다 — DISCONNECT 는 Spring 내부가
 * 세션 큐 밖에서 만들어 보내므로 그 큐에 넣을 자리가 없다. 표시는 DISCONNECT 의 {@code preSend}(실행·대기열 투입보다 먼저,
 * 보내는 스레드)에서 <b>소켓 세션 속성</b>에 남긴다. 그 소켓의 모든 프레임이 같은 Map 을 가리키므로 전역 상태·만료가 없고
 * 소켓과 함께 수거된다. 검사는 두 자리다: 실행 직전 {@code beforeHandle}(이미 실행기 큐에 있던 CONNECT)과
 * 송신 직전 {@code preSend}(순서 보존 큐가 뒤늦게 풀어 주는 프레임). DISCONNECT 는 언제나 통과한다.
 *
 * <p>버린 프레임은 순서 보존 완료 콜백을 부르지 않는다 — 운영 배선에서 이 가로채기가 Spring 의 콜백 가로채기보다 실행기
 * 목록 앞에 있다(콜백은 엔드포인트 등록 때 뒤에 붙는다). 끝난 세션의 순서 보존 큐는 더 참조되지 않아 함께 수거된다.
 *
 * <p><b>이미 검사를 지난 프레임은 보상한다.</b> CONNECT 가 {@code beforeHandle} 을 통과한 직후 다른 스레드가 같은 세션의
 * DISCONNECT 를 끝내면, 뒤이어 도는 CONNECT 가 브로커에 끝난 세션을 다시 등록한다(수신 워커 여럿 + caller-runs 라 생기는 창).
 * 그래서 {@code afterMessageHandled} 에서 처리가 끝난 비-DISCONNECT 프레임의 세션에 표시가 있으면, 그 브로커
 * ({@link AbstractBrokerMessageHandler})에 같은 세션의 합성 DISCONNECT 를 곧바로 넘겨 다시 지운다. 놓치지 않는 근거:
 * 표시(세션 속성 {@code ConcurrentHashMap} put)는 실제 DISCONNECT 의 브로커 세션 제거보다 먼저이고, 늦은 등록이 그 제거
 * 뒤라면 같은 키의 브로커 {@code ConcurrentHashMap} 연산으로 이어져 이 시점의 get 은 표시를 반드시 본다. 둘 다 지우게 되는
 * 경우 두 번째 제거는 무해하다 — 없는 세션의 {@code remove}·구독 해제는 아무 일도 하지 않고, DISCONNECT_ACK 는 이미
 * 세션이 없는 {@code SubProtocolWebSocketHandler} 가 버린다(실제 종료 DISCONNECT 의 ACK 와 같은 길). 세션별 잠금은 쓰지
 * 않는다 — 처리기가 던져 짝이 어긋나면 잠금이 새어 그 세션의 다음 프레임이 워커를 영원히 막는다. 브로커가 아닌 처리기
 * (어노테이션·사용자 목적지)는 세션 상태를 들지 않아 보내지 않는다.
 */
final class EndedSessionGuard implements ExecutorChannelInterceptor {

    static final String ENDED = EndedSessionGuard.class.getName() + ".ENDED";

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        MessageHeaders headers = message.getHeaders();
        if (isDisconnect(headers)) {
            Map<String, Object> attributes = SimpMessageHeaderAccessor.getSessionAttributes(headers);
            if (attributes != null) {
                attributes.put(ENDED, Boolean.TRUE);
            }
            return message;
        }
        return isEnded(headers) ? null : message;
    }

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        MessageHeaders headers = message.getHeaders();
        return !isDisconnect(headers) && isEnded(headers) ? null : message;
    }

    @Override
    public void afterMessageHandled(Message<?> message, MessageChannel channel, MessageHandler handler,
            Exception ex) {
        MessageHeaders headers = message.getHeaders();
        if (handler instanceof AbstractBrokerMessageHandler broker && !isDisconnect(headers) && isEnded(headers)) {
            broker.handleMessage(disconnectOf(headers));
        }
    }

    private static Message<byte[]> disconnectOf(MessageHeaders headers) {
        SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create(SimpMessageType.DISCONNECT);
        accessor.setSessionId(SimpMessageHeaderAccessor.getSessionId(headers));
        accessor.setSessionAttributes(SimpMessageHeaderAccessor.getSessionAttributes(headers));
        accessor.setUser(SimpMessageHeaderAccessor.getUser(headers));
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    private static boolean isDisconnect(MessageHeaders headers) {
        return SimpMessageType.DISCONNECT.equals(SimpMessageHeaderAccessor.getMessageType(headers));
    }

    private static boolean isEnded(MessageHeaders headers) {
        Map<String, Object> attributes = SimpMessageHeaderAccessor.getSessionAttributes(headers);
        return attributes != null && attributes.containsKey(ENDED);
    }
}
