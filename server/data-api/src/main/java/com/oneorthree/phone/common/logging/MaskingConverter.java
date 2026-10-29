package com.oneorthree.phone.common.logging;

import ch.qos.logback.classic.pattern.MessageConverter;
import ch.qos.logback.classic.spi.ILoggingEvent;

import java.util.List;
import java.util.regex.Pattern;

/**
 * PII (Personal identifiable Information) Masking
 */
public class MaskingConverter extends MessageConverter {

    /**
     * 이메일: vol****@****.***
     */
    // 선형 시간: 로컬 파트 시작을 «앞이 로컬 문자가 아닌 곳 또는 직전 매치 끝(\G)»으로 묶고 나머지는 possessive 로 받는다.
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
            "(?:(?<![a-zA-Z0-9._%+\\-])|\\G)([a-zA-Z0-9._%+\\-]{1,3}+)"
                    + "[a-zA-Z0-9._%+\\-]*+@([a-zA-Z0-9.\\-]+)\\.([a-zA-Z]{2,})"
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

    /**
     * SENSITIVE_KV 의 키 목록(소문자). (?i) 는 ASCII 만 대소문자를 무시하므로 ASCII 대소문자 무시 검색에서 키가 없으면 매치도 없다.
     */
    private static final List<String> SENSITIVE_KEYS = List.of("password", "accesstoken", "access_token", "mobile",
            "email", "cardnumber", "card_number", "cvv", "secret");

    /**
     * 이메일·휴대폰·주민번호 패턴이 쓰는 문자(ASCII). 사전 자르기 끝에 이 문자가 이어져 있으면 잘린 토큰일 수 있다.
     */
    private static final String TOKEN_PUNCTUATION = "._%+@-";

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
     * <p>키·{@code @} 가 없는 입력은 그 규칙을 건너뛴다 — 매치할 수 없어 결과는 같고, 긴 스택에서 정규식 두 번을 아낀다.
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
        if (hasSensitiveKey(message)) {
            result = SENSITIVE_KV_PATTERN.matcher(result).replaceAll(m ->
                    m.group(1) + "****"
            );
        }

        // 2. 이메일
        if (result.indexOf('@') >= 0) {
            result = EMAIL_PATTERN.matcher(result).replaceAll(m ->
                    m.group(1) + "****@****.***"
            );
        }

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

    /**
     * 사전 자르기({@link ObservationJsonProvider})로 끝에 걸린 토큰 문자({@code [A-Za-z0-9._%+@-]}) 연속 구간을 버린다.
     * 잘린 이메일·휴대폰·주민번호 조각은 마스킹 패턴에 안 걸려 원문이 그대로 남기 때문이다. 다른 세 서비스의
     * {@code LogMasking.dropCutToken}·logs.lua 의 {@code drop_cut_token} 과 같은 규칙이다.
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
