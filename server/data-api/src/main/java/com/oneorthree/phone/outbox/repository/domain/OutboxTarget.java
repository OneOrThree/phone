package com.oneorthree.phone.outbox.repository.domain;

/**
 * 봉투 하나가 나가야 하는 <b>전달 대상</b>.
 *
 * <p>표시가 단일 {@code published_at} 이 아니라 대상별인 이유는 A21 에 있다 — 링크 서버는 Kafka 를
 * 소비하지 않으므로({@code 계약 §2}) 같은 사건이 브로커로도 가고 HTTP 로도 간다. 하나로 합치면
 * 한쪽만 실패했을 때 성공한 쪽까지 재전달되거나(중복) 실패한 쪽이 영영 안 간다(유실).
 *
 * <p>값을 늘릴 때는 {@code V51__event_outbox.sql} 의 {@code target} CHECK 제약도 함께 늘린다 —
 * 한쪽만 늘리면 새 대상이 INSERT 에서 죽는다.
 */
public enum OutboxTarget {

    /** {@code notification-events} 토픽. key = userId, value = 정본 봉투(A12·A21). */
    KAFKA,

    /** 링크 서버(Neon 소유)로 가는 내부 명령 — HTTP. 링크는 Kafka 에 붙지 않는다. */
    LINK,

    /** 알림 서버로 가는 동기 명령의 <b>재시도 실패분</b> — HTTP. 기기 토큰 삭제·설정 최종 상태 등. */
    NOTI,

    /**
     * 새 섬 이벤트·권한 제어. 수신·인가·snapshot 복구가 준비되기 전에는 transport를 등록하지 않고
     * 미전달 행을 보존한다. NOTI/Kafka로 우회하거나 저장만으로 전달 완료 처리하지 않는다.
     */
    REALTIME
}
