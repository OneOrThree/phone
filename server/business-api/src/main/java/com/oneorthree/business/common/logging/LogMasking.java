package com.oneorthree.business.common.logging;

import java.util.regex.Pattern;

/**
 * 로그 message·exception 의 PII 를 가린다. data-api {@code MaskingConverter.mask} 와 같은 4규칙·같은 순서를
 * 이 서비스에 복제했다(서비스 간 공유 코드 없음). 정규식 그물이라 민감 값을 애초에 찍지 않는 것이 1차 방어다.
 */
final class LogMasking {

    private static final Pattern SENSITIVE_KV = Pattern.compile(
            "(?i)((?:password|accessToken|access_token|mobile|email|cardNumber|card_number|cvv|secret)"
                    + "(?:\\s*=\\s*|\\s*\"\\s*:\\s*\"\\s*|\\s*:\\s*))[^&\"\\s,}]+");
    // 선형 시간: 로컬 파트 시작을 «앞이 로컬 문자가 아닌 곳 또는 직전 매치 끝(\G)»으로 묶고 나머지는 possessive 로 받는다.
    private static final Pattern EMAIL = Pattern.compile(
            "(?:(?<![a-zA-Z0-9._%+\\-])|\\G)([a-zA-Z0-9._%+\\-]{1,3}+)"
                    + "[a-zA-Z0-9._%+\\-]*+@([a-zA-Z0-9.\\-]+)\\.([a-zA-Z]{2,})");
    private static final Pattern PHONE = Pattern.compile("(01[016789])[\\-.]?(\\d{3,4})[\\-.]?(\\d{4})");
    private static final Pattern SSN = Pattern.compile("(\\d{6})[\\-](\\d)(\\d{6})");

    private LogMasking() {
    }

    /** 순서 고정: 민감 키=값 → 이메일 → 휴대폰 → 주민번호. 키=값이 먼저여야 {@code email=a@b.com} 값 전체가 가려진다. */
    static String mask(String value) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        String result = SENSITIVE_KV.matcher(value).replaceAll(m -> m.group(1) + "****");
        result = EMAIL.matcher(result).replaceAll(m -> m.group(1) + "****@****.***");
        result = PHONE.matcher(result).replaceAll(m -> m.group(1) + "-****-" + m.group(3));
        return SSN.matcher(result).replaceAll(m -> m.group(1) + "-" + m.group(2) + "******");
    }
}
