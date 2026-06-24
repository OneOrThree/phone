package com.oneorthree.phone.common.logging;

import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

import static net.logstash.logback.argument.StructuredArguments.keyValue;

/**
 * 유저/비즈니스 이벤트 전용 발행기. "bizevent" 로거로 구조화 JSON 1라인을 남긴다.
 * PII는 필드 통제(1차) + MaskingConverter(2차)로 막고, 로깅 실패는 비즈니스에 전파하지 않는다.
 * 설계: docs/superpowers/specs/2026-06-24-gromo-384-bizevent-logger-design.md §4.4
 */
@Component
public class BizEventLogger {

    // TODO GROMO-384: 필드
    //   - "bizevent" 이름의 SLF4J Logger 상수 (logback-spring.xml 의 <logger name="bizevent"> 와 이름 일치 필수)
    //   - SOURCE 상수 = "server"
    //   - env 필드: application.yml 의 spring.profiles.active 주입 (@Value, 기본값 local)
    private static final Logger BIZ = LoggerFactory.getLogger("bizevent");
    private static final String SOURCE = "server";
    @Value("${spring.profiles.active:local}")
    private String env;


    // TODO GROMO-384: log(String event, String category, Map<String,Object> payload)
    //   - 인증된 요청용. user_id 는 MDC("user_id") 에서 읽어 아래 4-인자 오버로드에 위임
    public void log(String event, String category, Map<String, Object> payload) {
        log(MDC.get("user_id"), event, category, payload);
    }


    // TODO GROMO-384: log(String userId, String event, String category, Map<String,Object> payload)
    //   - 인증 전 이벤트(로그인 직후·게스트 등)용. userId 직접 전달
    //   - bizevent 로거에 INFO 로 발행하되, event·category·user_id·source·env·payload 를
    //     StructuredArguments(keyValue) 로 실어 logstash JSON 인코더가 "필드"로 출력하게 한다
    //   - payload 는 발행 전 마스킹(아래 mask) — BIZEVENT 는 %mask(텍스트 패턴)를 거치지 않으므로 수동 2차 방어
    //   - 전체를 try-catch 로 감싸 로깅 실패가 비즈니스 흐름을 막지 않게 (예외 삼킴)
    public void log (String userId, String event, String category, Map<String, Object> payload) {
        try {
            BIZ.info("biz_event",
                    keyValue("event", event),
                    keyValue("category", category),
                    keyValue("user_id", userId),
                    keyValue("source", SOURCE),
                    keyValue("env", env),
                    keyValue("payload", mask(payload)));
        } catch (Exception e) {
            // 로깅 실패가 비즈니스 흐름을 막지 않게 삼킨다
            BIZ.warn("bizevent 발행 실패 event={}", event, e);
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
