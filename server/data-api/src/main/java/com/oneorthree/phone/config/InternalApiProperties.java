package com.oneorthree.phone.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 내부 표면({@code /internal/*}) 의 인증 설정 — <b>기본값은 「꺼짐」이다</b> (A22 ㊀ · ㉱).
 *
 * <h2>왜 기본이 꺼짐인가</h2>
 * 이 표면이 들어가는 시점에 Business 도 알림 서버도 아직 배포돼 있지 않다. 켜진 채로 들어가면
 * 토큰 없이 뜬 인스턴스가 「누구나 {@code X-User-Id} 를 실어 남의 데이터를 쓰는」 구멍이 된다.
 * 그래서 <b>caller 가 하나도 없으면 경로 전체가 존재하지 않는 것처럼</b> 동작한다.
 *
 * <h2>caller 별 토큰 + 경로 허용목록</h2>
 * 이름만 나누는 것으로는 최소 권한이 서지 않는다(㉱) — 알림 자격으로 {@code /internal/auth/*} 나
 * 이관 트리거에 닿을 수 있기 때문이다. 그래서 caller 마다 <b>토큰 하나</b>와 <b>METHOD + 경로 패턴
 * 목록</b>을 함께 준다. 목록에 없는 조합은 통과하지 않는다 — 「모르면 일단 허용」은 새 엔드포인트가
 * 추가될 때마다 조용히 권한을 넓힌다.
 *
 * <p>토큰을 서로 공유하면 수신 측이 호출자를 구분하지 못해 허용목록이 합쳐지고, 한쪽 유출이 다른 쪽
 * 명령을 연다(㊀ — 총 7종을 따로 두는 이유다).
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "internal.api")
public class InternalApiProperties {

    /** 꺼짐이 기본이다. caller 설정이 실제로 주입된 뒤 켠다. */
    private boolean enabled = false;

    /**
     * caller 이름 → 자격·허용목록. 이름은 로그·거부 사유에만 쓰이고 판정은 토큰이 한다.
     */
    private final Map<String, Caller> callers = new LinkedHashMap<>();

    /** 호출자 하나. */
    @Getter
    @Setter
    public static class Caller {

        /** 이 호출자에게만 발급한 서비스 토큰. */
        private String token;

        /**
         * 허용 조합 — {@code "METHOD /internal/…"} 형식. 경로는 Ant 패턴({@code *} · {@code **})이다.
         *
         * <p>{@code *} 는 <b>한 segment</b> 만 먹으므로 {@code /internal/users/&#42;/activation} 이
         * 다른 하위 경로를 삼키지 않는다. {@code **} 를 쓰면 그 아래가 통째로 열리니 꼭 필요한 곳에만 쓴다.
         */
        private List<String> allow = new ArrayList<>();
    }

    /**
     * 켜진 경우에만 검증한다 — 꺼져 있으면 아무 값도 요구하지 않는다.
     *
     * <p>여기서 죽는 편이 낫다: 토큰이 빈 채로 켜지면 「빈 문자열 토큰」이 통과하는 구멍이 되고,
     * 허용목록이 빈 caller 는 아무것도 못 하면서 자격만 들고 있는 상태라 둘 다 배선 사고다.
     *
     * @throws IllegalStateException 필수값이 비었거나 허용 항목의 형식이 어긋날 때
     */
    public void validateWhenEnabled() {
        if (!enabled) {
            return;
        }
        if (callers.isEmpty()) {
            throw new IllegalStateException(
                    "internal.api.enabled=true 인데 caller 가 하나도 없습니다 — 켤 이유가 없는 설정입니다.");
        }
        callers.forEach((name, caller) -> {
            requireResolvedSecret("internal.api.callers." + name + ".token", caller.getToken());
            if (caller.getAllow() == null || caller.getAllow().isEmpty()) {
                throw new IllegalStateException(
                        "internal.api.callers." + name + ".allow 가 비었습니다 — 허용목록 없는 자격은 만들지 않습니다.");
            }
            caller.getAllow().forEach(entry -> validateAllowEntry(name, entry));
        });
        long distinctTokens = callers.values().stream().map(Caller::getToken).distinct().count();
        if (distinctTokens != callers.size()) {
            // 토큰이 겹치면 먼저 매칭된 caller 의 허용목록이 적용돼, 둘의 권한이 사실상 합쳐진다(㊀).
            throw new IllegalStateException("internal.api 의 caller 토큰이 서로 겹칩니다 — caller 별로 분리해야 합니다.");
        }
    }

    /**
     * 자격값이 <b>실제로 채워졌는지</b> 확인한다 — 빈 값과 <b>미해결 placeholder</b> 둘 다 거부한다.
     *
     * <p>후자가 실물에서 확인된 함정이다: {@code ${SVC_TOKEN_BIZ_TO_DATA}} 처럼 환경변수가 없는 채로
     * 뜨면 Spring 이 그 <b>문자열 자체</b>를 값으로 넣는다. blank 검사만 하면 그대로 통과해, 운영에서
     * 「모두가 아는 토큰 하나로 열린 내부 표면」이 된다 — 그리고 그 사실은 아무 오류도 내지 않는다.
     *
     * @param property 설정 키 — 실패 메시지에 그대로 실린다
     * @param value    확인할 값
     * @throws IllegalStateException 비었거나 미해결 placeholder 일 때
     */
    private static void requireResolvedSecret(String property, String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(property + " 미설정");
        }
        String trimmed = value.trim();
        // 인증 헤더는 앞뒤 공백을 제거한 뒤 대조한다. 설정에서만 공백을 허용하면 별개로 검증된
        // 자격이 요청 시 다른 caller의 토큰과 같아지므로 기동에서 거절한다.
        if (!value.equals(trimmed)) {
            throw new IllegalStateException(property + " 앞뒤 공백은 허용하지 않습니다.");
        }
        if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
            throw new IllegalStateException(
                    property + " 가 미해결 placeholder 입니다(" + trimmed + ") — 환경변수가 주입되지 않았습니다.");
        }
    }

    private static void validateAllowEntry(String callerName, String entry) {
        if (entry == null || entry.isBlank()) {
            throw new IllegalStateException("internal.api.callers." + callerName + ".allow 에 빈 항목이 있습니다.");
        }
        String[] parts = entry.trim().split("\\s+");
        if (parts.length != 2) {
            throw new IllegalStateException(
                    "internal.api.callers." + callerName + ".allow 항목은 \"METHOD /path\" 형식이어야 합니다: " + entry);
        }
        if (!parts[1].startsWith("/internal/")) {
            // /internal 밖을 허용목록에 넣을 수 있으면 이 필터가 «전 경로용 게이트»가 되어,
            // 앱 JWT 경로를 서비스 토큰으로 여는 길이 생긴다.
            throw new IllegalStateException(
                    "internal.api 허용목록은 /internal/ 아래만 가질 수 있습니다: " + entry);
        }
        if (!parts[0].equals(parts[0].toUpperCase(Locale.ROOT))) {
            throw new IllegalStateException("internal.api 허용목록의 method 는 대문자여야 합니다: " + entry);
        }
    }
}
