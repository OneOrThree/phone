package com.oneorthree.phone.internal.notification.dto;

/**
 * 발송해도 되는가 — 그리고 <b>안 되면 왜</b>.
 *
 * <p>{@code reason} 이 있어야 「보내지 않았다」가 감사 가능해진다. 이유 없는 {@code false} 는
 * 「정책상 안 보냄」과 「우리가 뭔가 잘못 조회함」을 구분하지 못한다.
 *
 * <p><b>일시 오류는 이 응답으로 오지 않는다.</b> DB 장애·타임아웃은 {@code false} 로 접지 않고
 * 5xx 로 나간다 — {@code false} 로 삼키면 <b>장애 동안의 알림이 통째로 사라지고</b> 재시도할
 * 근거도 남지 않는다(계약 §5 「gate 가 닫혀도 발송 요청은 durable pending 으로 받는다」와 같은 정신).
 *
 * @param eligible 보내도 되는가
 * @param reason   거절 사유 코드. 허용이면 {@code null}
 */
public record NotificationEligibilityResponse(boolean eligible, String reason) {

    /** 허용. */
    public static NotificationEligibilityResponse allow() {
        return new NotificationEligibilityResponse(true, null);
    }

    /**
     * 거절.
     *
     * @param reason 사유 코드
     * @return 거절 응답
     */
    public static NotificationEligibilityResponse deny(String reason) {
        return new NotificationEligibilityResponse(false, reason);
    }
}
