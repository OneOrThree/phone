package com.oneorthree.realtime.logging;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 로그 message·exception 의 PII 를 가린다. data-api {@code MaskingConverter.mask} 와 같은 4규칙·같은 순서를
 * 이 서비스에 복제했다(서비스 간 공유 코드 없음). 정규식 그물이라 민감 값을 애초에 찍지 않는 것이 1차 방어다.
 * 네 서비스가 같은 결과를 내는지는 test resources 의 공통 입력표({@code log-contract-vectors.tsv})로 확인한다.
 */
final class LogMasking {

    private static final Pattern SENSITIVE_KV = Pattern.compile(
            "(?i)((?:password|accessToken|access_token|mobile|email|cardNumber|card_number|cvv|secret)"
                    + "(?:\\s*=\\s*|\\s*\"\\s*:\\s*\"\\s*|\\s*:\\s*))[^&\"\\s,}]+");
    // SENSITIVE_KV 의 키 목록(소문자). (?i) 는 ASCII 만 대소문자를 무시하므로 소문자로 바꾼 입력에 키가 없으면 매치도 없다.
    private static final List<String> SENSITIVE_KEYS = List.of("password", "accesstoken", "access_token", "mobile",
            "email", "cardnumber", "card_number", "cvv", "secret");
    // 선형 시간: 로컬 파트 시작을 «앞이 로컬 문자가 아닌 곳 또는 직전 매치 끝(\G)»으로 묶고 나머지는 possessive 로 받는다.
    private static final Pattern EMAIL = Pattern.compile(
            "(?:(?<![a-zA-Z0-9._%+\\-])|\\G)([a-zA-Z0-9._%+\\-]{1,3}+)"
                    + "[a-zA-Z0-9._%+\\-]*+@([a-zA-Z0-9.\\-]+)\\.([a-zA-Z]{2,})");
    private static final Pattern PHONE = Pattern.compile("(01[016789])[\\-.]?(\\d{3,4})[\\-.]?(\\d{4})");
    private static final Pattern SSN = Pattern.compile("(\\d{6})[\\-](\\d)(\\d{6})");
    /** 이메일·휴대폰·주민번호 패턴이 쓰는 문자(ASCII). 사전 자르기 끝에 이 문자가 이어져 있으면 잘린 토큰일 수 있다. */
    private static final String TOKEN_PUNCTUATION = "._%+@-";

    private LogMasking() {
    }

    /**
     * 순서 고정: 민감 키=값 → 이메일 → 휴대폰 → 주민번호. 키=값이 먼저여야 {@code email=a@b.com} 값 전체가 가려진다.
     * 키·{@code @} 가 없는 입력은 그 규칙을 건너뛴다 — 매치할 수 없어 결과는 같고, 긴 스택에서 정규식 두 번을 아낀다.
     */
    static String mask(String value) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        String result = value;
        String lower = value.toLowerCase(Locale.ROOT);
        if (SENSITIVE_KEYS.stream().anyMatch(lower::contains)) {
            result = SENSITIVE_KV.matcher(result).replaceAll(m -> m.group(1) + "****");
        }
        if (result.indexOf('@') >= 0) {
            result = EMAIL.matcher(result).replaceAll(m -> m.group(1) + "****@****.***");
        }
        result = PHONE.matcher(result).replaceAll(m -> m.group(1) + "-****-" + m.group(3));
        return SSN.matcher(result).replaceAll(m -> m.group(1) + "-" + m.group(2) + "******");
    }

    /**
     * 사전 자르기로 끝에 걸린 토큰 문자({@code [A-Za-z0-9._%+@-]}) 연속 구간을 버린다. 잘린 이메일·휴대폰·주민번호 조각은
     * 마스킹 패턴에 안 걸려 원문이 그대로 남기 때문이다. logs.lua 의 {@code drop_cut_token} 과 같은 규칙이다.
     * ponytail: 사전 자르기 지점까지 이어진 긴 덩어리(구분자 없는 수십 KiB)는 통째로 빠진다 — 출력이 짧아질 뿐 원문 조각은 안 남는다.
     */
    static String dropCutToken(String head) {
        int end = head.length();
        while (end > 0 && isTokenChar(head.charAt(end - 1))) {
            end--;
        }
        return head.substring(0, end);
    }

    private static boolean isTokenChar(char c) {
        return c < 128 && (Character.isLetterOrDigit(c) || TOKEN_PUNCTUATION.indexOf(c) >= 0);
    }
}
