package com.oneorthree.business.common.logging;

import java.util.List;
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
    // SENSITIVE_KV 의 키 목록(소문자). (?i) 는 ASCII 만 대소문자를 무시하므로 ASCII 대소문자 무시 검색에서 키가 없으면 매치도 없다.
    private static final List<String> SENSITIVE_KEYS = List.of("password", "accesstoken", "access_token", "mobile",
            "email", "cardnumber", "card_number", "cvv", "secret");
    // 선형 시간: 로컬 파트 시작을 «앞이 로컬 문자가 아닌 곳 또는 직전 매치 끝(\G)»으로 묶고 나머지는 possessive 로 받는다.
    private static final Pattern EMAIL = Pattern.compile(
            "(?:(?<![a-zA-Z0-9._%+\\-])|\\G)([a-zA-Z0-9._%+\\-]{1,3}+)"
                    + "[a-zA-Z0-9._%+\\-]*+@([a-zA-Z0-9.\\-]+)\\.([a-zA-Z]{2,})");
    private static final Pattern PHONE = Pattern.compile("(01[016789])[\\-.]?(\\d{3,4})[\\-.]?(\\d{4})");
    private static final Pattern SSN = Pattern.compile("(\\d{6})[\\-](\\d)(\\d{6})");
    /** 이메일·휴대폰·주민번호 패턴이 쓰는 문자와 마스킹이 넣는 '*'(ASCII). 사전 자르기 끝에 이 문자가 이어져 있으면 잘린 토큰일 수 있다. */
    private static final String TOKEN_PUNCTUATION = "._%+@-*";

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
        if (hasSensitiveKey(value)) {
            result = SENSITIVE_KV.matcher(result).replaceAll(m -> m.group(1) + "****");
        }
        if (result.indexOf('@') >= 0) {
            result = EMAIL.matcher(result).replaceAll(m -> m.group(1) + "****@****.***");
        }
        result = PHONE.matcher(result).replaceAll(m -> m.group(1) + "-****-" + m.group(3));
        return SSN.matcher(result).replaceAll(m -> m.group(1) + "-" + m.group(2) + "******");
    }

    /** 사전 자르기 꼬리에서 버리는 토큰 문자 최대 길이. logs.lua MAX_CUT_TOKEN 과 같다. */
    static final int MAX_CUT_TOKEN = 254;

    /**
     * 사전 자르기한 입력을 <b>마스킹한 결과</b>의 끝에 이어진 토큰 문자({@code [A-Za-z0-9._%+@*-]}) 구간을 버린다. 잘린 이메일·휴대폰·주민번호
     * 조각은 마스킹 패턴에 안 걸려 원문이 그대로 남기 때문이다. logs.lua 의 {@code drop_cut_token} 과 같은 규칙이다.
     * 마스킹 뒤에 버리므로 자르기 지점 앞의 완전한 번호·이메일은 이미 가려져 있다 — 버리는 경계가 그것을 갈라 패턴에 안 걸리는 조각
     * ({@code tel:0101234})을 남기지 않는다. '*' 도 버리는 문자라 잘린 이메일 안의 휴대폰만 먼저 가려진 경우에도 그 앞 로컬 파트까지 버린다.
     * 버리는 길이는 {@link #MAX_CUT_TOKEN}(254) 자까지다: 이메일은 전체가 254자 이하(RFC 5321)이고 휴대폰·주민번호는 14자 이하라
     * 잘린 조각은 끝 254자 안에 있다. 구분자 없는 긴 덩어리는 끝 254자만 빠지고 앞은 남는다.
     * ponytail: 254자를 넘는 덩어리의 앞부분은 남는다 — 유효 이메일이 아니라 마스킹 대상 밖으로 둔다.
     */
    static String dropCutToken(String masked) {
        int end = masked.length();
        int floor = Math.max(0, end - MAX_CUT_TOKEN);
        while (end > floor && isTokenChar(masked.charAt(end - 1))) {
            end--;
        }
        return masked.substring(0, end);
    }

    private static boolean isTokenChar(char c) {
        return c < 128 && (Character.isLetterOrDigit(c) || TOKEN_PUNCTUATION.indexOf(c) >= 0);
    }

    /**
     * 민감 키가 ASCII 대소문자 무시로 들어 있는지 새 문자열 없이 선형 스캔한다. toLowerCase 는 «İ» 처럼 길이가 늘어나는 문자에서
     * 입력마다 재할당이 커져(16384자에 약 800 MB) 쓰지 않는다. 정규식 (?i) 가 ASCII 만 무시하므로 결과는 같다.
     */
    private static boolean hasSensitiveKey(String s) {
        for (int i = 0, n = s.length(); i < n; i++) {
            char c = s.charAt(i);
            if (c >= 'A' && c <= 'Z') {
                c += 'a' - 'A';
            }
            // 키 첫 글자(p·a·m·e·c·s)가 아니면 키 비교를 건너뛴다 — 긴 스택에서 대부분의 위치가 여기서 끝난다.
            if (c != 'p' && c != 'a' && c != 'm' && c != 'e' && c != 'c' && c != 's') {
                continue;
            }
            for (String key : SENSITIVE_KEYS) {
                if (key.charAt(0) == c && i + key.length() <= n && matchesAsciiIgnoreCase(s, i, key)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** key 는 소문자 ASCII. 비ASCII 문자는 접지 않으므로 일치하지 않는다. */
    private static boolean matchesAsciiIgnoreCase(String s, int from, String key) {
        for (int k = 0; k < key.length(); k++) {
            char c = s.charAt(from + k);
            if (c >= 'A' && c <= 'Z') {
                c += 'a' - 'A';
            }
            if (c != key.charAt(k)) {
                return false;
            }
        }
        return true;
    }
}
