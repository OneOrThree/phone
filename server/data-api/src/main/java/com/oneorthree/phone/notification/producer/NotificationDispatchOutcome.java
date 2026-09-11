package com.oneorthree.phone.notification.producer;

/**
 * 알림 요청 하나의 처리 결과 — 구 경로와 신 경로가 <b>같은 자리</b>에서 갈린다.
 *
 * <p>구 경로는 「보냈는가」 하나면 됐다(호출부가 그 값으로 {@code sent_log} 를 기록했다). 신 경로는
 * 보내지 않고 «적기»만 하므로 그 축이 성립하지 않는다 — {@code true} 를 돌려주면 호출부가
 * <b>Data 쪽 발송 이력을 완료로 기록</b>해 버리고, 그 순간 두 DB 의 이력이 갈린다(계약 §5 —
 * 「발송 후 sentLog 를 Data 에서 완료 처리하지 않는다」).
 */
public enum NotificationDispatchOutcome {

    /** 구 경로에서 FCM 발송이 성사됐다 — 호출부는 종전대로 {@code sent_log} 를 기록한다. */
    SENT,

    /** 구 경로에서 필터 스킵·무효 토큰·발송 실패 — 종전대로 기록하지 않는다. */
    NOT_SENT,

    /** 신 경로에서 사건을 outbox 에 적었다. 발송 여부는 알림 서버가 판정한다. */
    QUEUED,

    /** 신 경로에서 같은 결정적 키가 이미 있었다 — 재훑기·겹치는 크론의 정상 동작이다. */
    DUPLICATE;

    /**
     * @return 호출부가 {@code notification_sent_logs} 에 완료 행을 남겨야 하는가.
     *     신 경로는 <b>언제나 false</b> 다 — 발송 이력의 정본이 알림 DB 로 옮겨 갔다
     */
    public boolean recordsLegacyLog() {
        return this == SENT;
    }

    /** @return 신 경로로 처리됐는가(적었든 중복이든) — 호출부가 구 클레임 기계를 건너뛰는 근거 */
    public boolean isOutbox() {
        return this == QUEUED || this == DUPLICATE;
    }
}
