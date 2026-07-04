package com.oneorthree.phone.common.port;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * 푸시 발송 NoOp 구현 (GROMO-528) — local·ci 프로파일 전용.
 * 선례: NoOpScreenTimeNotification (같은 패키지), 프로파일 게이팅은 LeagueBatchController 선례.
 */
@Slf4j
@Component
@Profile({"local", "ci"})
public class NoOpPushNotification implements PushNotificationPort {

    @Override
    public PushSendResult send(String deviceToken, PushMessage message) {
        // 토큰은 자격증명이라 전체 로그 금지 — 앞 8자만 (8자 미만 방어 포함)
        String tokenPrefix = deviceToken.substring(0, Math.min(8, deviceToken.length()));
        log.debug("NoOp 푸시 스킵 — token={}..., title={}", tokenPrefix, message.title());
        return PushSendResult.SENT;
    }
}
