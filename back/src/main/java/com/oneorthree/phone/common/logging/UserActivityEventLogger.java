package com.oneorthree.phone.common.logging;

import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

import static net.logstash.logback.argument.StructuredArguments.keyValue;

@Component
public class UserActivityEventLogger {

    private static final Logger USER_ACTIVITY = LoggerFactory.getLogger("user-activity");
    private static final String SOURCE = "server";
    @Value("${spring.profiles.active:local}")
    private String env;


    /** 인증된 요청용. user_id 는 MDC("user_id") 에서 자동으로 읽어 아래 오버로드에 위임. */
    public void log(UserActivityEvent event, Map<String, Object> payload) {
        log(MDC.get("user_id"), event, payload);
    }

    /**
     * 인증 전 이벤트(로그인 직후·게스트 등)용 — userId 직접 전달.
     * event·category(=BizEvent에서)·user_id·source·env·payload 를 StructuredArguments 로 실어
     * logstash JSON 인코더가 "필드"로 출력하게 한다. payload 는 발행 전 2차 마스킹.
     * 로깅 실패가 비즈니스 흐름을 막지 않도록 예외를 삼킨다.
     */
    public void log(String userId, UserActivityEvent event, Map<String, Object> payload) {
        try {
            USER_ACTIVITY.info("user_activity",
                    keyValue("event", event.event()),
                    keyValue("category", event.category()),
                    keyValue("user_id", userId),
                    keyValue("source", SOURCE),
                    keyValue("env", env),
                    keyValue("payload", mask(payload)));
        } catch (Exception e) {
            USER_ACTIVITY.warn("user-activity 발행 실패 event={}", event, e);
        }
    }

    /** payload 의 String 값만 PII 마스킹(2차 방어). BIZEVENT 는 %mask 텍스트 패턴을 거치지 않으므로 수동. */
    private Map<String, Object> mask(Map<String, Object> payload) {
        if (payload == null || payload.isEmpty()) {
            return Map.of();
        }
        Map<String, Object> masked = new LinkedHashMap<>();
        payload.forEach((key, value) ->
                masked.put(key, value instanceof String s ? MaskingConverter.mask(s) : value));
        return masked;
    }
}
