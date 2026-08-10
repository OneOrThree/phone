package com.oneorthree.phone.notification.domain;

/**
 * 발송 로그 행의 클레임 상태 (GROMO-1417, N41·N44).
 *
 * <p>발송 여부의 단일 소스는 {@code notification_sent_logs} 인데, "조회 후 발송·성공 후 기록"
 * 순서는 인스턴스가 둘이 되는 순간 이중 발송을 허용한다. 그래서 발송 <b>전에</b> 사건 유니크 키
 * {@code (user_id, kind, subject_id)} 로 {@code PENDING} 행을 INSERT 해 선점하고, 결과에 따라
 * 전이한다.
 */
public enum NotificationSendStatus {

    /** 선점됨(클레임) — {@code claimed_at} 기준 10분 리스. 만료되면 다른 워커가 재클레임한다. */
    PENDING,

    /**
     * 조용한 시간(기본 23–07) 이월 대기(N44) — 표시 푸시를 버리지 않고 조용한 시간이 끝난 뒤
     * 발송한다. 묶음·dedup 은 원래 슬롯({@code slot_at}) 기준을 유지한다.
     */
    DEFERRED,

    /** 발송 성사(또는 소비 확정) — 이 사건은 다시 나가지 않는다. */
    SENT
}
