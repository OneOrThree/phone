package com.oneorthree.phone.common.logging;

import ch.qos.logback.classic.pattern.MessageConverter;
import ch.qos.logback.classic.spi.ILoggingEvent;

import java.util.regex.Pattern;

/**
 * PII (Personal identifiable Information) Masking
 */
public class MaskingConverter extends MessageConverter {

    /**
     * 이메일: vol****@****.***
     */
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
            "([a-zA-Z0-9._%+\\-]{1,3})[a-zA-Z0-9._%+\\-]*@([a-zA-Z0-9.\\-]+)\\.([a-zA-Z]{2,})"
    );

    /**
     * 한국 휴대폰: 010-****-5678
     */
    private static final Pattern PHONE_PATTERN = Pattern.compile(
            "(01[016789])[\\-.]?(\\d{3,4})[\\-.]?(\\d{4})"
    );

    /**
     * 주민등록번호: 123456-1******
     */
    private static final Pattern SSN_PATTERN = Pattern.compile(
            "(\\d{6})[\\-](\\d)(\\d{6})"
    );

    /**
     * 민감 키=값 쌍 (password=, email=, cardNumber= 등)
     * key=value  |  "key":"value"  |  key:value (따옴표 없는 콜론, toString 출력 포함)
     */
    private static final Pattern SENSITIVE_KV_PATTERN = Pattern.compile(
            "(?i)((?:password|accessToken|access_token|mobile|email|cardNumber|card_number|cvv|secret)"
                    + "(?:\\s*=\\s*|\\s*\"\\s*:\\s*\"\\s*|\\s*:\\s*))[^&\"\\s,}]+"
    );

    @Override
    public String convert(ILoggingEvent event) {
        String message = event.getFormattedMessage();
        if (message == null || message.isEmpty()) {
            return message;
        }
        return mask(message);
    }

    /**
     * 문자열에서 PII 로 보이는 부분을 가린다. logback 패턴({@code %mask})을 타지 않는 경로
     * — 특히 {@link UserActivityEventLogger} 의 payload — 가 직접 부를 수 있도록 static 이다.
     *
     * <p><b>적용 순서가 결과를 바꾼다.</b> 민감 키=값(1) → 이메일(2) → 휴대폰(3) → 주민번호 순인데,
     * 키=값을 먼저 처리해야 {@code email=a@b.com} 이 값 전체로 가려진다. 순서를 뒤집으면
     * 이메일 규칙이 먼저 먹어 키 이름만 남고 값의 일부가 살아남는다.
     *
     * @param message 원본 로그 문자열. null·빈 문자열은 그대로 돌려준다
     * @return 마스킹된 문자열. <b>정규식 기반이라 완벽하지 않다</b> — 새로운 형태의 PII 는 그대로
     *         통과하므로, 애초에 민감 값을 로그에 넣지 않는 것이 1차 방어이고 이건 2차 그물이다
     */
    public static String mask(String message) {
        if (message == null || message.isEmpty()) {
            return message;
        }

        String result = message;

        // 1. 민감 키=값 쌍 (email=, password= 등) — 이메일보다 먼저 처리
        result = SENSITIVE_KV_PATTERN.matcher(result).replaceAll(m ->
                m.group(1) + "****"
        );

        // 2. 이메일
        result = EMAIL_PATTERN.matcher(result).replaceAll(m ->
                m.group(1) + "****@****.***"
        );

        // 3. 한국 휴대폰
        result = PHONE_PATTERN.matcher(result).replaceAll(m ->
                m.group(1) + "-****-" + m.group(3)
        );

        // 4. 주민등록번호
        result = SSN_PATTERN.matcher(result).replaceAll(m ->
                m.group(1) + "-" + m.group(2) + "******"
        );

        return result;
    }
}
