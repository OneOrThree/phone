package com.oneorthree.phone.notification.client;

/**
 * FCM 클라이언트 단위 테스트 (GROMO-528 커밋②).
 * HTTP 왕복 자체는 dev 배포 후 수동 트리거로 확인 — 여기선 조립/매핑 메서드만.
 */
class FcmPushNotificationClientTest {

    // TODO GROMO-528 커밋②: 메시지 JSON 조립 검증 (package-private 조립 메서드 대상)
    //   - title/body/data.link 매핑
    //   - soundEnabled true → apns.payload.aps.sound = "default" 포함 / false → apns 블록 생략
    // TODO GROMO-528 커밋②: 응답 매핑 검증
    //   - 200 → SENT / 404 UNREGISTERED → INVALID_TOKEN / 400 INVALID_ARGUMENT → INVALID_TOKEN / 500 → FAILED
}
