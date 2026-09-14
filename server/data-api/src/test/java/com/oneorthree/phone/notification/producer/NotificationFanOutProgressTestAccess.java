package com.oneorthree.phone.notification.producer;

/** 테스트 전용 — 다른 패키지의 테스트가 «이 배치에서 앞 조각이 이미 커밋됐다» 는 상태를 세운다. */
public final class NotificationFanOutProgressTestAccess {

    private NotificationFanOutProgressTestAccess() {
    }

    /**
     * @param progress 열린 배치 범위를 가진 진행 기록
     */
    public static void recordCommittedChunk(NotificationFanOutProgress progress) {
        progress.recordCommittedChunk();
    }
}
