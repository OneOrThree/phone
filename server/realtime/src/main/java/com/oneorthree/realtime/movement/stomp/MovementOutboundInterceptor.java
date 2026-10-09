package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.config.StompTopics;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.stereotype.Component;

/**
 * {@code clientOutboundChannel} 에서 이동 프레임 한 건의 처리가 끝났음을 그 {@link MovementOutbox} 에 알린다 —
 * 세션당 in-flight 1건(N3)의 «완료» 쪽 절반이다.
 *
 * <p><b>아웃바운드 인터셉터 목록의 맨 앞이어야 한다</b>({@code WebSocketConfig}). {@code ExecutorSubscribableChannel}
 * 은 {@code beforeHandle} 을 통과한 인터셉터에게만 {@code afterMessageHandled} 를 돌려준다 — 뒤에 두면 앞의
 * {@code ChatOutboundChannelInterceptor} 가 프레임을 버린 경우(토큰 만료) 완료 통지가 영영 오지 않아 그 outbox 가
 * 멈춘다.
 *
 * <p>프레임을 꺼낼 때({@code beforeHandle}) 그 outbox 가 넘긴 뒤 게이트가 다시 닫혔거나(강퇴 재검사 멈춤·세션 교체·
 * movement 해지 — 그사이 재개됐어도) 닫혔으면 그 한 건도 버린다 — 실행기에 밀려 있던 프레임이 강퇴·퇴장한 세션에 한 번
 * 더 나가거나, 재개 뒤 재동기화 FullState 보다 먼저 나가지 않게.
 */
@Slf4j
@Component
public class MovementOutboundInterceptor implements ExecutorChannelInterceptor {

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        if (message.getHeaders().get(MovementOutbox.MARK) instanceof MovementOutbox.Ticket ticket
                && ticket.withheld()) {
            // 맨 앞 인터셉터가 null 을 돌려주면 자기 afterMessageHandled 가 오지 않는다 — 여기서 끝난 것으로 쳐야
            // in-flight 가 굳지 않는다.
            ticket.release();
            return null;
        }
        return message;
    }

    @Override
    public void afterMessageHandled(Message<?> message, MessageChannel channel, MessageHandler handler,
            Exception ex) {
        if (message.getHeaders().get(MovementOutbox.MARK) instanceof MovementOutbox.Ticket ticket) {
            if (ex != null) {
                // 전송 실패도 «처리 끝»이다 — 여기서 멈추면 그 세션의 이동 송신이 영영 서 버린다.
                log.debug("이동 프레임 처리 실패 — 다음 건으로 넘어간다. reason={}", ex.getClass().getSimpleName());
            }
            ticket.release();
            return;
        }
        if (SimpMessageHeaderAccessor.getMessageType(message.getHeaders()) == SimpMessageType.MESSAGE) {
            String destination = SimpMessageHeaderAccessor.getDestination(message.getHeaders());
            if (destination != null && StompTopics.MOVEMENT_TOPIC.matcher(destination).matches()) {
                // 이동 토픽은 outbox 만 보낸다 — 표식이 없으면 중간에 헤더가 사라졌거나 다른 경로가 보냈다.
                log.warn("완료 표식 없는 이동 프레임 — 그 세션 송신은 워치독이 풀 때까지 멈춰 있을 수 있다");
            }
        }
    }
}
