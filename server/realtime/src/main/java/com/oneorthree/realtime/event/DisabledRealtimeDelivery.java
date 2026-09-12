package com.oneorthree.realtime.event;

import org.springframework.stereotype.Component;

/** 골격만으로 실제 발행이 성공했다고 오인하지 않도록 명시적으로 거절한다. */
@Component
public class DisabledRealtimeDelivery implements RealtimeDelivery {

    @Override
    public void deliver(RealtimeEventEnvelope event, RealtimeAudience audience, String destination) {
        throw new IllegalStateException("신규 실시간 도메인의 전달 인가가 아직 활성화되지 않았습니다.");
    }
}
