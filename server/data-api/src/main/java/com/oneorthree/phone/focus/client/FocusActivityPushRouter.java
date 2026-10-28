package com.oneorthree.phone.focus.client;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.util.Map;

/** APNs와 FCM 토큰은 환경 값으로 분리하며 서로의 전송 주소로 보내지 않는다. */
@Component
@Primary
@RequiredArgsConstructor
public class FocusActivityPushRouter implements LiveActivityPushClient {
    private final ApnsLiveActivityClient apns;
    private final FcmFocusActivityClient fcm;

    @Override
    public boolean enabled() {
        return apns.enabled() || fcm.enabled();
    }

    @Override
    public Result send(String token, String environment, Map<String, Object> payload) {
        return "android".equals(environment) ? fcm.send(token, payload) : apns.send(token, environment, payload);
    }
}
