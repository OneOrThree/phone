package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.MessageHeaders;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.broker.AbstractBrokerMessageHandler;
import org.springframework.messaging.simp.user.UserDestinationMessageHandler;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;

import java.util.Map;

/**
 * 끝난 STOMP 세션의 늦은 프레임이 브로커 상태를 되살리지 못하게 한다. 수신 채널과 브로커 채널 둘 다에 건다.
 *
 * <p>소켓 종료 때 Spring 이 만드는 DISCONNECT({@code StompSubProtocolHandler.afterSessionEnded})는 세션별 순서 보존 큐
 * ({@code OrderedMessageChannelDecorator})를 거치지 않고 수신 채널로 바로 간다. 수신 큐가 차 있으면
 * {@link InboundCallerRunsPolicy} 가 그것을 종료 스레드에서 곧바로 처리해, 실행기 큐에 아직 남은 그 세션의 CONNECT 를
 * 추월한다. 뒤늦게 돈 CONNECT 는 {@code SimpleBrokerMessageHandler} 에 닫힌 세션을 다시 등록하고, {@code heart-beat:0,0}
 * 세션은 지울 무활동 타임아웃도 없어 영구히 남는다. 순서 보존 큐가 그 뒤에 풀어 주는 SUBSCRIBE 도 구독 레지스트리에 남는다.
 *
 * <p><b>표시는 소켓이 실제로 닫힐 때만</b>, 소켓 세션 속성에 남긴다({@link #markEnded}). {@code afterSessionEnded} 가 종료
 * DISCONNECT 를 보내기 직전에 같은 스레드로 발행하는 {@code SessionDisconnectEvent} 를 {@code WebSocketConfig} 가 받아
 * 표시한다. 클라이언트가 보낸 DISCONNECT 프레임은 순서 보존 큐를 그대로 지나 추월이 없고 그 이벤트도 내지 않으므로
 * 표시하지 않는다 — 표시하면 바로 앞 프레임의 보상이 receipt 없는 DISCONNECT_ACK 를 먼저 내보내 정상 종료 확인이
 * {@code ERROR Session closed.} 로 바뀐다. 그 소켓의 모든 프레임이 같은 Map 을 가리키므로 전역 상태·만료가 없고 소켓과
 * 함께 수거된다. 검사는 두 자리다: 실행 직전 {@code beforeHandle}(이미 실행기 큐에 있던 CONNECT)과 송신 직전 {@code preSend}
 * (순서 보존 큐가 뒤늦게 풀어 주는 프레임). DISCONNECT 는 언제나 통과한다. 앱이 {@code SimpMessagingTemplate} 으로 보내는
 * 메시지는 세션 속성이 없어 언제나 통과한다.
 *
 * <p>버린 프레임은 순서 보존 완료 콜백을 부르지 않는다 — 운영 배선에서 이 가로채기가 Spring 의 콜백 가로채기보다 실행기
 * 목록 앞에 있다(콜백은 나중에 뒤에 붙는다). 끝난 세션의 순서 보존 큐는 더 참조되지 않아 함께 수거된다.
 *
 * <p><b>이미 검사를 지난 프레임은 보상한다.</b> 프레임이 {@code beforeHandle} 을 통과한 직후 다른 스레드가 같은 세션의
 * 종료를 끝내면, 뒤이어 도는 처리가 끝난 세션의 상태를 다시 만든다(수신 워커 여럿 + caller-runs 라 생기는 창). 그래서
 * {@code afterMessageHandled} 에서 처리가 끝난 비-DISCONNECT 프레임의 세션에 표시가 있으면, 세션 상태를 드는 처리기에
 * 같은 세션의 합성 DISCONNECT 를 곧바로 넘겨 다시 지운다. 대상은 브로커({@link AbstractBrokerMessageHandler} — 세션·구독)와
 * {@link UserDestinationMessageHandler}(세션별 순서 보존 전송 템플릿 — DISCONNECT 를 받아야 지운다)다. 어노테이션 처리기는
 * 세션 상태를 들지 않아 보내지 않는다. 사용자 목적지 처리기가 늦은 SUBSCRIBE 를 브로커 채널로 다시 보내므로(원본 세션
 * 속성을 그대로 싣는다) 브로커 채널에도 이 가드를 건다. 놓치지 않는 근거: 표시(세션 속성 {@code ConcurrentHashMap} put)는
 * 종료 DISCONNECT 의 제거보다 먼저이고, 늦은 등록이 그 제거 뒤라면 같은 키의 {@code ConcurrentHashMap} 연산으로 이어져
 * 이 시점의 get 은 표시를 반드시 본다. 둘 다 지우게 되는 경우 두 번째 제거는 무해하다 — 없는 세션의 {@code remove}·구독
 * 해제·템플릿 제거는 아무 일도 하지 않고, DISCONNECT_ACK 는 이미 세션이 없는 {@code SubProtocolWebSocketHandler} 가 버린다.
 * 세션별 잠금은 쓰지 않는다 — 처리기가 던져 짝이 어긋나면 잠금이 새어 그 세션의 다음 프레임이 워커를 영원히 막는다.
 * 보상 DISCONNECT 의 ACK 는 {@link OutboundSendBudget} 이 큐에 넣기 전에 버린다({@link #isCompensationAck}) — 표시는
 * {@code SubProtocolWebSocketHandler} 가 세션을 지운 «뒤»에만 붙으므로 그 ACK 는 어차피 버려진다. 큐에 넣으면 포화 중
 * {@code realtime.outbound.dropped{reason=queue_full}} 만 부풀린다. 보상 횟수는 {@code realtime.inbound.ended.compensated}.
 *
 * <p>세션 상태를 드는 처리기·리스너를 새로 붙이면 위 보상 목록에 넣거나 등록 직후 {@link #isEnded} 를 본다 — 지금은
 * {@code RealtimeSessionRegistry} 의 구독 기록을 {@code StompAuthChannelInterceptor} 가 등록 직후 확인해 되돌린다. 이동 구독
 * ({@code MovementSubscriptionListener})은 세션별 {@code compute} 안의 {@code isConnected} 와 종료 정리 순서로 이미 닫혀 있다.
 */
final class EndedSessionGuard implements ExecutorChannelInterceptor {

    static final String ENDED = EndedSessionGuard.class.getName() + ".ENDED";

    /** 보상 DISCONNECT 표지 — 그 ACK 를 아웃바운드 큐에 넣지 않게 알아본다. */
    private static final String COMPENSATION = EndedSessionGuard.class.getName() + ".COMPENSATION";

    private final Counter brokerCompensated;
    private final Counter userCompensated;

    EndedSessionGuard(MeterRegistry registry) {
        this.brokerCompensated = compensated(registry, "broker");
        this.userCompensated = compensated(registry, "user");
    }

    private static Counter compensated(MeterRegistry registry, String handler) {
        return Counter.builder("realtime.inbound.ended.compensated").tag("handler", handler)
                .description("검사를 지난 뒤 끝난 세션의 상태를 합성 DISCONNECT 로 되지운 횟수").register(registry);
    }

    /** 소켓이 닫혔다 — 종료 DISCONNECT 를 보내기 전에, 같은 스레드에서 부른다. */
    static void markEnded(Map<String, Object> socketAttributes) {
        if (socketAttributes != null) {
            socketAttributes.put(ENDED, Boolean.TRUE);
        }
    }

    /** 소켓이 닫혔는가 — 세션 상태를 등록한 직후 확인해 되돌릴 때 쓴다. */
    static boolean isEnded(Map<String, Object> socketAttributes) {
        return socketAttributes != null && socketAttributes.containsKey(ENDED);
    }

    /** 보상 DISCONNECT 에 브로커가 답한 ACK 인가 — 받을 소켓이 이미 없다. */
    static boolean isCompensationAck(Message<?> message) {
        return SimpMessageType.DISCONNECT_ACK.equals(SimpMessageHeaderAccessor.getMessageType(message.getHeaders()))
                && message.getHeaders().get(SimpMessageHeaderAccessor.DISCONNECT_MESSAGE_HEADER) instanceof Message<?> d
                && d.getHeaders().containsKey(COMPENSATION);
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        return lateFrame(message.getHeaders()) ? null : message;
    }

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        return lateFrame(message.getHeaders()) ? null : message;
    }

    @Override
    public void afterMessageHandled(Message<?> message, MessageChannel channel, MessageHandler handler,
            Exception ex) {
        Counter compensated = handler instanceof AbstractBrokerMessageHandler ? brokerCompensated
                : handler instanceof UserDestinationMessageHandler ? userCompensated : null;
        if (compensated != null && lateFrame(message.getHeaders())) {
            handler.handleMessage(disconnectOf(message.getHeaders()));
            compensated.increment();
        }
    }

    private static boolean lateFrame(MessageHeaders headers) {
        if (SimpMessageType.DISCONNECT.equals(SimpMessageHeaderAccessor.getMessageType(headers))) {
            return false;
        }
        return isEnded(SimpMessageHeaderAccessor.getSessionAttributes(headers));
    }

    private static Message<byte[]> disconnectOf(MessageHeaders headers) {
        SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create(SimpMessageType.DISCONNECT);
        accessor.setSessionId(SimpMessageHeaderAccessor.getSessionId(headers));
        accessor.setSessionAttributes(SimpMessageHeaderAccessor.getSessionAttributes(headers));
        accessor.setUser(SimpMessageHeaderAccessor.getUser(headers));
        accessor.setHeader(COMPENSATION, Boolean.TRUE);
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}
