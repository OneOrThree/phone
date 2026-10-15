package com.oneorthree.realtime.event;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;

/**
 * 다른 인스턴스가 {@code chat:events:v1} 에 흘린 섬 사건을 받아 이 프로세스의 구독자에게 넘긴다.
 *
 * <p><b>자기가 보낸 것은 버린다.</b> Redis Pub/Sub 는 발행자 자신에게도 되돌려 주므로, 거르지 않으면
 * 발행한 인스턴스에 붙어 있는 사람만 같은 사건을 두 번 받는다 — 인스턴스가 한 대인 개발 환경에서는
 * «전원이 두 번»이라 눈에 띄지만, 두 대 이상이면 «일부만 두 번»이 되어 훨씬 찾기 어렵다.
 *
 * <p>역직렬화 실패는 해당 건만 버린다. 리스너에서 예외를 밖으로 던지면 컨테이너가 그 구독을 끊을 수
 * 있고, 그러면 <b>이 인스턴스만 조용히 실시간 수신이 죽는다</b>.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RealtimeEventFanoutSubscriber implements MessageListener {

    private final RealtimeEventDelivery delivery;
    private final ObjectMapper objectMapper;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            RealtimeEventFanoutEvent event = objectMapper.readValue(
                    new String(message.getBody(), StandardCharsets.UTF_8), RealtimeEventFanoutEvent.class);

            if (delivery.instanceId().equals(event.originInstanceId())) {
                // 내가 발행한 것 — 로컬 전달은 deliver() 에서 이미 끝났다.
                return;
            }
            delivery.deliverLocally(event.destination(), event.event(), event.recipients());
        } catch (Exception e) {
            // 예외 «객체»를 통째로 기록하지 않는다 — Jackson 의 역직렬화 예외 메시지에는 깨진 JSON 조각이
            // 실리고, 거기엔 subject 같은 사용자 입력이 들어 있을 수 있다(LLD §6: 원문·payload 로깅 금지).
            log.error("섬 사건 팬아웃 수신 처리 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
        }
    }
}
