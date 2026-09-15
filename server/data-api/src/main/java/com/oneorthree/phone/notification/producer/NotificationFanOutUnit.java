package com.oneorthree.phone.notification.producer;

import java.util.function.Function;

/**
 * 짧은 트랜잭션으로 나눠 적을 때 <b>절대 갈라서는 안 되는 묶음</b>의 단위 (GROMO-893).
 *
 * <p>배치 fan-out 은 USER 잠금을 오래 쥐지 않으려고 수신자를 조각마다 별도 트랜잭션으로 적는다.
 * 그런데 알림 서버가 «함께 도착해야 한 건으로 접는» 사건들이 조각 경계에서 갈리면, 앞 조각만 커밋된
 * 사이에 다른 경로(슬롯 봉인·flush)가 끼어 묶음이 둘로 쪼개진다. 그래서 조각을 나누는 기준을 kind 가 아니라
 * 호출부가 이 enum 으로 명시한다.
 */
public enum NotificationFanOutUnit {

    /**
     * 수신자 한 명의 사건 전부가 한 트랜잭션에 든다 — 모집·종료 묶음(유저 × 그룹 × 슬롯)과 묶음이 없는
     * kind 의 기본값이다. 한 사람의 {@code bundleMembers} 선언이 반쯤만 커밋되는 일이 없다.
     */
    RECIPIENT(request -> request.userId()),

    /**
     * (그룹 × 결과 슬롯)의 사건 전부가 한 트랜잭션에 든다 — 결과·환불 묶음의 봉인 단위다.
     *
     * <p>봉인({@code ResultBundleCompletionService#seal})은 그룹·슬롯 단위로 «지금까지 등록된 사건»을
     * 기대 집합으로 굳힌다. 같은 슬롯의 사건이 두 조각으로 갈리면 앞 조각이 커밋된 틈에 봉인이 끼어
     * 뒤 조각의 사건이 「이미 완료된 결과 슬롯의 새 사건」으로 거절된다.
     */
    RESULT_SLOT(request -> request.groupId() + "@" + request.slotAt());

    private final Function<NotificationRequest, Object> key;

    NotificationFanOutUnit(Function<NotificationRequest, Object> key) {
        this.key = key;
    }

    /**
     * @param request 요청
     * @return 이 요청이 속한 원자 단위의 키
     */
    Object keyOf(NotificationRequest request) {
        return key.apply(request);
    }
}
