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
 * USER-ACTIVITY 로그 발행기 — 애플리케이션 로그와 분리된 {@code user-activity} 로거로
 * 구조화 필드({@code event}·{@code category}·{@code user_id}·{@code source}·{@code env}·{@code payload})를
 * 내보낸다. 산문 로그가 아니라 <b>분석 대상 데이터</b>라 필드 이름이 곧 대시보드 쿼리의 계약이다.
 *
 * <p>{@code source} 로 서버가 관찰한 사실과 클라가 보고한 사실을 갈라 둔다 —
 * 클라 이벤트는 신뢰도가 다르므로 집계할 때 섞으면 안 된다.
 *
 * <p><b>발행 실패는 절대 비즈니스 흐름을 막지 않는다.</b> {@code emit} 이 예외를 삼키고 warn 만 남긴다.
 * payload 는 발행 직전 {@link MaskingConverter} 로 한 번 더 마스킹한다 — 이 로거는 logback 의
 * {@code %mask} 텍스트 패턴을 거치지 않아서, 여기서 안 하면 아무도 안 한다.
 */
@Component
public class UserActivityEventLogger {

    private static final Logger USER_ACTIVITY = LoggerFactory.getLogger("user-activity");
    private static final String SOURCE_SERVER = "server";
    private static final String SOURCE_CLIENT = "client";
    @Value("${spring.profiles.active:local}")
    private String env;


    /**
     * 인증된 요청용. user_id 는 MDC("user_id") 에서 자동으로 읽어 아래 오버로드에 위임.
     *
     * <p>MDC 값은 {@code TraceIdFilter} 가 심는다 — 필터가 걸리지 않는 경로나 크론 스레드에서
     * 부르면 {@code user_id} 가 null 로 나가므로, 그런 곳에서는 아래 오버로드를 써야 한다.
     *
     * @param event 발행할 이벤트. {@code event}·{@code category} 필드가 여기서 나온다
     * @param payload 이벤트 부가 정보. String 값은 발행 직전 PII 마스킹을 거치고,
     *                null 이면 빈 맵으로 대체된다
     */
    public void log(UserActivityEvent event, Map<String, Object> payload) {
        log(MDC.get("user_id"), event, payload);
    }

    /**
     * 인증 전 이벤트(로그인 직후·게스트 등)용 — userId 직접 전달. source="server".
     *
     * @param userId 로그에 실을 유저 식별자. {@code /auth/*} 는 인증 필터를 타지 않아 MDC 가 비어 있으므로
     *               호출부가 방금 만들거나 찾은 값을 직접 넘긴다
     * @param event 발행할 이벤트
     * @param payload 이벤트 부가 정보 — String 값은 마스킹을 거친다
     */
    public void log(String userId, UserActivityEvent event, Map<String, Object> payload) {
        emit(userId, event, SOURCE_SERVER, payload);
    }

    /**
     * 클라 수신 이벤트(analytics 엔드포인트)용 — source="client". user_id 는 MDC 자동.
     *
     * @param event 앱이 보고한 이벤트. 서버가 관찰한 사실이 아니라 <b>클라가 주장한</b> 사실이므로
     *              {@code source=client} 로 갈라 기록한다
     * @param payload 앱이 보낸 부가 정보. 외부 입력이라 그대로 신뢰하지 않고 마스킹을 거친다
     */
    public void logClient(ActivityEvent event, Map<String, Object> payload) {
        emit(MDC.get("user_id"), event, SOURCE_CLIENT, payload);
    }

    /**
     * event·category·user_id·source·env·payload 를 StructuredArguments 로 실어
     * logstash JSON 인코더가 "필드"로 출력하게 한다. payload 는 발행 전 2차 마스킹.
     * 로깅 실패가 비즈니스 흐름을 막지 않도록 예외를 삼킨다.
     */
    private void emit(String userId, ActivityEvent event, String source, Map<String, Object> payload) {
        try {
            USER_ACTIVITY.info("user_activity",
                    keyValue("event", event.event()),
                    keyValue("category", event.category()),
                    keyValue("user_id", userId),
                    keyValue("source", source),
                    keyValue("env", env),
                    keyValue("payload", mask(payload)));
        } catch (Exception e) {
            USER_ACTIVITY.warn("user-activity 발행 실패 event={}", event, e);
        }
    }

    /** payload 의 String 값만 PII 마스킹(2차 방어). USER-ACTIVITY 로그는 %mask 텍스트 패턴을 거치지 않으므로 수동. */
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
