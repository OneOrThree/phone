package com.oneorthree.realtime.sea;

import java.util.UUID;

/**
 * {@code chat:sea:v1} 에 실려 다니는 한 건 — {@code RealtimeEventFanoutEvent} 의 바다 방 판(수신 제한 없음).
 *
 * @param originInstanceId 발행한 인스턴스 — 받는 쪽이 자기 메아리를 거른다
 * @param destination      브로커 목적지
 * @param event            앱이 받는 6필드 사건
 */
public record SeaRoomFanoutEvent(UUID originInstanceId, String destination, SeaRoomEvent event) {
}
