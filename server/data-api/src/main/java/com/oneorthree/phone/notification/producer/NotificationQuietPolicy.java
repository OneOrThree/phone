package com.oneorthree.phone.notification.producer;

/**
 * 조용한 시간(기본 23–07 KST)에 걸렸을 때 그 알림을 어떻게 하는가 — <b>판정은 알림 서버가 한다</b>.
 *
 * <p>Data 는 정책만 싣고 실행하지 않는다(계약 §5 — 「Data 잔류 판정 잡의 출력은 결정적 사건 키 +
 * 발송 params 를 담은 outbox 명령이다. Notification 은 claim/render/send/flush 를 소유한다」).
 * 여기서 조용한 시간을 직접 걸러 버리면 <b>설정을 두 곳이 읽는다</b> — 설정 최종 상태의 정본은
 * 이관 후 알림 DB 이므로, Data 가 자기 사본으로 거르면 갱신이 늦은 쪽이 사용자의 설정을 어긴다.
 *
 * <p>구 경로가 kind 마다 서로 다르게 굴었고 그 차이가 전부 의도된 것이라, 값을 실어 보낸다.
 */
public enum NotificationQuietPolicy {

    /**
     * 버린다 — 지연 도착이 <b>거짓말이 되는</b> 알림. 리그 마감·「오늘 아직 0분」·승리 확정 축하가
     * 여기다. 구 {@code sendIfAllowed} 의 기본 동작이기도 하다.
     */
    DROP,

    /**
     * 조용한 시간이 끝난 뒤 보낸다(N44) — 내기 결과·무산 환불. 하루형은 자정 정산이라 이월이 없으면
     * 결과 알림이 <b>매번</b> 침묵한다. 묶음·dedup 은 원래 슬롯을 유지한다.
     */
    DEFER,

    /**
     * 이월하되 <b>만료가 있다</b> — 회차 참여 모집. 조용한 시간 종료 시점에 이미 참가 마감이면
     * 그때 도착해봐야 「참여하세요」가 거짓이므로 버린다(N44 단서). 만료 시각은
     * {@code params.deferExpiresAt} 으로 함께 싣는다 — 그 값이 없으면 {@link #DEFER} 와 같다.
     */
    DEFER_UNTIL,

    /**
     * 필터를 타지 않는다 — 사일런트(data-only) 푸시. 표시가 아니라 앱 백그라운드 기동이라
     * 「표시에 대한 약속」인 조용한 시간·알림 off 와 무관하다(HLD §6 예외).
     */
    BYPASS
}
