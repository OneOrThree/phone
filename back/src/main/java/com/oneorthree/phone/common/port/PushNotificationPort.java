package com.oneorthree.phone.common.port;

/**
 * 서버 푸시 발송 포트 (GROMO-528).
 * 구현: FcmPushNotificationClient(dev·staging·prod) / NoOpPushNotification(local·ci) — @Profile 게이팅.
 */
public interface PushNotificationPort {

    /**
     * 단건 푸시 발송.
     *
     * @param deviceToken FCM registration token ({@code User.deviceToken})
     * @param message     제목·본문·딥링크·사운드 설정
     * @return 발송 결과 — {@link PushSendResult#INVALID_TOKEN} 이면 호출측이 deviceToken 을 null 로 정리한다
     */
    PushSendResult send(String deviceToken, PushMessage message);
}
