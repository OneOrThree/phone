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
     * realtime 서비스로 가는 섬 사건·{@code user.withdrawn}. 전달 경로는 HTTP({@code POST /internal/events})가
     * 기본이고 {@code outbox.relay.realtime-kafka-enabled} 일 때만 {@code realtime-events} 토픽이다
     * (2026-09-19 R-1). {@code notification-events}(KAFKA)·NOTI 로 우회하거나 저장만으로 전달 완료 처리하지 않는다.
     */
    REALTIME,

    /**
     * 랭킹 적격성 사건({@code user.onboarded}, ㊣) — 목표는 {@code score-events} 토픽(key=userId)의 랭킹 소비자다.
     * 소비자·transport 가 아직 없어 <b>적고 보내지 않는다</b>(relay 는 transport 가 없는 대상을 건너뛴다, V80).
     * 순서 판정이 대상별이라 이 보류가 다른 대상의 USER 축 사건을 막지 않는다.
     */
    SCORE
}
