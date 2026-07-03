package com.oneorthree.phone.common.logging;

/**
 * USER-ACTIVITY 로그로 발행 가능한 이벤트 계약.
 * 서버 이벤트(UserActivityEvent)와 클라 수신 이벤트(analytics 의 ClientActivityEvent)가 공유한다.
 */
public interface ActivityEvent {

    String event();

    String category();
}
