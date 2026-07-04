package com.oneorthree.phone.common.port;

/**
 * 푸시 메시지 페이로드
 * FE 계약(PR #104 push.ts): notification.title/body 표시 + data.link 딥링크 라우팅.
 * data 키는 link 하나만 — 트리거 확장(578/579)에서 필요해지면 Map 으로 완화(지금은 YAGNI).
 */
public record PushMessage(
        /** 알림 제목 (apns.md §3 문구). */
        String title,
        /** 알림 본문 — 치환 완료된 최종 문자열. */
        String body,
        /** data payload 의 link 키 값 (예: "gromo://league") — FE 가 content.data.link 로 소비. */
        String link,
        /** true 면 FCM apns.payload.aps.sound = "default" 포함, false 면 생략. */
        boolean soundEnabled
) {
}
