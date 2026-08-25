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
