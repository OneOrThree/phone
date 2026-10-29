package com.oneorthree.realtime.sea;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.realtime.fanout.FanoutTelemetry;

import java.util.UUID;

/**
 * {@code chat:sea:v1} 에 실려 다니는 한 건 — {@code RealtimeEventFanoutEvent} 의 바다 방 판(수신 제한 없음).
 *
 * @param originInstanceId 발행한 인스턴스 — 받는 쪽이 자기 메아리를 거른다
 * @param destination      브로커 목적지
 * @param event            앱이 받는 6필드 사건
 * @param telemetry        원인 요청·사건 연결용 내부 메타데이터(GROMO-2581) — 없으면 wire 에서 빠지고, 옛 구독자는 모르는 키로
 *                         무시한다. 소켓으로 나가는 것은 {@code event} 뿐이라 클라이언트에 닿지 않는다
 */
public record SeaRoomFanoutEvent(UUID originInstanceId, String destination, SeaRoomEvent event,
        @JsonInclude(JsonInclude.Include.NON_NULL) FanoutTelemetry telemetry) {

    /** 메타데이터 없는 옛 모양. */
    public SeaRoomFanoutEvent(UUID originInstanceId, String destination, SeaRoomEvent event) {
        this(originInstanceId, destination, event, null);
    }
}
