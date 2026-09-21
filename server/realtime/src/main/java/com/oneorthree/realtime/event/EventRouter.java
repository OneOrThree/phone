package com.oneorthree.realtime.event;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Objects;

/** 신규 15종 이벤트의 단일 내부 발행 진입점. STOMP SEND나 외부 HTTP에서 직접 호출하지 않는다. */
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
            // 응원의 수신 자격은 구독 인가보다 좁다(그 섬에서 «지금» 진행 중인 주민). 그 집합을 싣지 않고
            // 보내면 전달 직전 판정이 근거를 잃고 전원 공개가 된다 — 빈 집합을 «제한 없음»으로 읽기 때문이다.
            if (event.type() == RealtimeEventType.FOCUS_EMOTE && island.recipients().isEmpty()) {
                throw new IllegalArgumentException("응원은 수신 대상을 명시해야 합니다.");
            }
            destination = "/topic/islands/" + island.islandId() + "/" + event.type().channel();
        } else if (audience instanceof RealtimeAudience.UserAudience users) {
            // 개인 축이 남은 자산은 inventory 뿐이다 — 지갑은 섬 단위 하나라(GROMO-1989) 봉투가
            // 섬 없는 wallet.updated 를 이미 거절한다.
            boolean personalAsset = event.islandId() == null
                    && event.type() == RealtimeEventType.INVENTORY_UPDATED;
            if (!personalAsset && event.type() != RealtimeEventType.JOIN_REQUEST_UPDATED) {
                throw new IllegalArgumentException("이벤트를 개인 큐로 보낼 수 없습니다.");
            }
            if (personalAsset && (users.userIds().size() != 1
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
