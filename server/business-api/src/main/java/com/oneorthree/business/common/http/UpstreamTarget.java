package com.oneorthree.business.common.http;

/**
 * 이 서비스가 호출할 수 있는 상류 셋. <b>caller 별로 분리된 서비스 토큰</b>(A22 ㊀)의 단위이기도 하다.
 *
 * <p>토큰을 하나로 공유하면 수신 측이 호출자를 구분하지 못해 허용목록이 합쳐지고, 한쪽 유출이 다른
 * 쪽 명령을 연다. 그래서 {@code SVC_TOKEN_BIZ_TO_DATA} · {@code SVC_TOKEN_BIZ_TO_NOTI} ·
 * {@code SVC_TOKEN_BIZ_TO_LINK} 를 각각 <b>명시된 대상에만</b> 보낸다 — 이 enum 이 그 「대상」이다.
 */
public enum UpstreamTarget {

    /** Data API — {@code gromo} DB 의 유일한 소유자. 활성 검사·내구 명령·판정이 여기 있다. */
    DATA,
    /** 알림 서버 — {@code gromo_notification} 소유. 설정 정본·기기 토큰·발송 이력. */
    NOTIFICATION,
    /** 링크 서버 — Neon 소유. 발급·claim·클릭 소진. 코어를 부르지 않는다. */
    LINK
}
