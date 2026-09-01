package com.oneorthree.phone.common.logging;

/**
 * USER-ACTIVITY 로그로 발행 가능한 이벤트 계약.
 * 서버 이벤트(UserActivityEvent)와 클라 수신 이벤트(analytics 의 ClientActivityEvent)가 공유한다.
 */
public interface ActivityEvent {

    /**
     * @return USER-ACTIVITY 로그의 {@code event} 필드가 될 이름. 로그 검색·대시보드 쿼리가 이 문자열을
     *         직접 잡으므로, 값을 바꾸면 기존 대시보드가 조용히 0건이 된다
     */
    String event();

    /**
     * @return 이벤트를 묶는 상위 분류. 로그를 도메인 단위로 걸러 보기 위한 축이라
     *         같은 도메인의 이벤트끼리는 반드시 같은 값을 써야 한다
     */
    String category();
}
