package com.oneorthree.realtime.event;

/** 후속 도메인이 인가·권한 회수·재연결 복구를 갖춘 뒤 구현할 전달 경계. */
public interface RealtimeDelivery {

    void deliver(RealtimeEventEnvelope event, RealtimeAudience audience, String destination);
}
