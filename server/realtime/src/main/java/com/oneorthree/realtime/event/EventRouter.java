package com.oneorthree.realtime.event;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Objects;

/** 신규 14종 이벤트의 단일 내부 발행 진입점. STOMP SEND나 외부 HTTP에서 직접 호출하지 않는다. */
@Component
@RequiredArgsConstructor
public class EventRouter {

    private final RealtimeDelivery delivery;

    public void route(RealtimeEventEnvelope event, RealtimeAudience audience) {
        Objects.requireNonNull(event, "event");
        Objects.requireNonNull(audience, "audience");
        String destination;
        if (audience instanceof RealtimeAudience.IslandAudience island) {
            if (!island.islandId().equals(event.islandId())
                    || event.type() == RealtimeEventType.JOIN_REQUEST_UPDATED) {
                throw new IllegalArgumentException("이벤트와 섬 수신 대상이 일치하지 않습니다.");
            }
            destination = "/topic/islands/" + island.islandId() + "/" + event.type().channel();
        } else if (audience instanceof RealtimeAudience.UserAudience users) {
            boolean personalWallet = event.islandId() == null
                    && (event.type() == RealtimeEventType.WALLET_UPDATED
                    || event.type() == RealtimeEventType.INVENTORY_UPDATED);
            if (!personalWallet && event.type() != RealtimeEventType.JOIN_REQUEST_UPDATED) {
                throw new IllegalArgumentException("이벤트를 개인 큐로 보낼 수 없습니다.");
            }
            if (personalWallet && (users.userIds().size() != 1
                    || !users.userIds().contains(EventPayloadValidator.ownerId(event.payload())))) {
                throw new IllegalArgumentException("개인 자산 이벤트는 본인 한 명에게만 전달합니다.");
            }
            destination = "/user/queue/events";
        } else {
            throw new IllegalArgumentException("알 수 없는 수신 대상입니다.");
        }
        delivery.deliver(event, audience, destination);
    }
}
