package com.oneorthree.phone.outbox.repository.domain;

/** 사건 전달 대상. 변경 시 V0 계열 migration의 target CHECK 제약도 함께 갱신한다. */
public enum OutboxTarget {

    /** {@code notification-events} 토픽. key = userId, value = 정본 봉투(A12·A21). */
    KAFKA,

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
