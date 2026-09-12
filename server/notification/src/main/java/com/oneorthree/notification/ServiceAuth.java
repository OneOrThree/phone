package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

@Configuration
class ServiceAuth implements WebMvcConfigurer, HandlerInterceptor {

    /** 콘솔 계정 이름의 허용 형태. 자유 문자열을 받으면 감사 원장의 actor 가 자유 입력이 된다. */
    private static final Pattern CONSOLE_ACTOR = Pattern.compile("member-[1-3]");

    private final Map<String, String> tokens;

    /** 콘솔 토큰 → 그 토큰이 «곧» 지목하는 행위자. 행위자는 요청이 아니라 자격이 정한다. */
    private final Map<String, String> consoleActors;

    ServiceAuth(@Value("${notification.tokens.business:}") String business,
            @Value("${notification.tokens.data:}") String data,
            @Value("${notification.tokens.console:}") String console) {
        require(business, "SVC_TOKEN_BIZ_TO_NOTI");
        require(data, "SVC_TOKEN_DATA_TO_NOTI");
        require(console, "SVC_TOKEN_CONSOLE_TO_NOTI");
        consoleActors = parseConsoleActors(console);
        if (business.equals(data) || consoleActors.containsKey(data) || consoleActors.containsKey(business)) {
            throw new IllegalStateException("알림 caller 토큰은 서로 달라야 합니다");
        }
        tokens = Map.of("business", business, "data", data);
    }

    /**
     * 콘솔 자격을 <b>행위자별로</b> 가른다 — {@code member-1:토큰,member-2:토큰,...} 형태다.
     *
     * <h2>왜 토큰 하나로는 안 되는가</h2>
     * 콘솔 사용자가 모두 같은 토큰으로 인증하면 <b>행위자를 말할 수 있는 것은 요청자 자신뿐</b>이다.
     * 예전에는 {@code X-Console-Actor} 헤더를 정규식으로만 검사했으므로, 콘솔 토큰을 가진
     * {@code member-1} 이 헤더에 {@code member-2} 를 적으면 템플릿 수정·시험 발송·재전송이 전부 남의
     * 행위로 기록됐다 — 감사 원장이 「누가 했는가」를 말하지 못하면 그 원장은 없는 것과 같다.
     *
     * <p>그래서 행위자를 <b>자격에서 도출</b>한다. 토큰마다 주인이 하나이므로 헤더가 무엇이라 말하든
     * 원장에는 그 토큰의 주인이 남는다.
     *
     * <p>토큰 하나짜리 옛 형태는 <b>기동에서 거부한다.</b> 조용히 받아 헤더를 믿는 쪽으로 되돌아가면
     * 설정만 보고는 감사가 신뢰할 수 있는 상태인지 알 수 없다 — 그 애매함이 이 결함의 본체다.
     *
     * @param console 설정 문자열
     * @return 토큰 → 행위자
     */
    private static Map<String, String> parseConsoleActors(String console) {
        Map<String, String> parsed = new LinkedHashMap<>();
        for (String entry : console.split(",")) {
            String pair = entry.trim();
            if (pair.isEmpty()) {
                continue;
            }
            int separator = pair.indexOf(':');
            if (separator <= 0) {
                throw new IllegalStateException("SVC_TOKEN_CONSOLE_TO_NOTI 는 member-N:토큰 목록이어야 합니다"
                        + " — 토큰 하나를 공유하면 감사 원장이 행위자를 구분하지 못합니다");
            }
            String actor = pair.substring(0, separator).trim();
            String token = pair.substring(separator + 1).trim();
            // 길이로 「콜론이 끝이 아니다」만 보면 «공백뿐인 토큰»이 통과한다. trim 이 떼지 못하는
            // 공백(U+2028 등)이 남으면 그것이 정상 토큰처럼 등재되고, 그때 두 가지가 같이 무너진다:
            // 유효한 콘솔 자격이 없어 관리 API 가 잠기고, 빈 문자열이 등재된 경우에는
            // "Bearer " + "" 가 뒤 공백을 보존하는 클라이언트의 `Authorization: Bearer ` 와 맞는다.
            // 값 자체를 보고 거절한다 — 기동에서 죽는 편이 «떠 있는데 잠긴» 것보다 낫다.
            if (token.isBlank()) {
                throw new IllegalStateException("콘솔 토큰이 비어 있습니다: " + actor);
            }
            // 길이로 「콜론이 끝이 아니다」만 보면 «공백뿐인 토큰»이 통과한다. trim 이 떼지 못하는
            // 공백(U+2028 등)이 남으면 그것이 정상 토큰처럼 등재되고, 그때 두 가지가 같이 무너진다:
            // 유효한 콘솔 자격이 없어 관리 API 가 잠기고, 빈 문자열이 등재된 경우에는
            // "Bearer " + "" 가 뒤 공백을 보존하는 클라이언트의 `Authorization: Bearer ` 와 맞는다.
            // 값 자체를 보고 거절한다 — 기동에서 죽는 편이 «떠 있는데 잠긴» 것보다 낫다.
            if (!CONSOLE_ACTOR.matcher(actor).matches()) {
                throw new IllegalStateException("콘솔 행위자 이름이 계약과 다릅니다: " + actor);
            }
            if (parsed.put(token, actor) != null) {
                throw new IllegalStateException("콘솔 행위자끼리 같은 토큰을 쓸 수 없습니다");
            }
        }
        if (parsed.isEmpty()) {
            throw new IllegalStateException("필수 설정 누락: SVC_TOKEN_CONSOLE_TO_NOTI");
        }
        return Map.copyOf(parsed);
    }

    static void require(String value, String key) {
        if (value == null || value.isBlank() || value.contains("${")) {
            throw new IllegalStateException("필수 설정 누락: " + key);
        }
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns("/internal/**");
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String authorization = request.getHeader("Authorization");
        String caller = null;
        String consoleActor = null;
        for (Map.Entry<String, String> entry : tokens.entrySet()) {
            if (matches(authorization, entry.getValue())) {
                caller = entry.getKey();
            }
        }
        for (Map.Entry<String, String> entry : consoleActors.entrySet()) {
            if (matches(authorization, entry.getKey())) {
                caller = "console";
                consoleActor = entry.getValue();
            }
        }
        if (caller == null) {
            throw new NotificationFailure(401, "SERVICE_AUTH_REQUIRED");
        }
        String path = request.getRequestURI();
        String method = request.getMethod();
        boolean allowed = switch (caller) {
            case "console" -> path.startsWith("/internal/admin/");
            case "data" -> "POST".equals(method) && "/internal/events".equals(path);
            default -> ("/internal/devices".equals(path) && ("POST".equals(method) || "DELETE".equals(method)))
                    || (path.matches("/internal/users/[0-9a-f-]{36}/notification-settings")
                        && ("GET".equals(method) || "PUT".equals(method)))
                    || (path.matches("/internal/users/[0-9a-f-]{36}/result-ack/(prepare|commit|abort)")
                        && "POST".equals(method));
        };
        if (!allowed) {
            throw new NotificationFailure(403, "SERVICE_ROUTE_FORBIDDEN");
        }
        if ("business".equals(caller)) {
            UUID user = delegatedUser(request);
            if (path.startsWith("/internal/users/") && !path.split("/")[3].equals(user.toString())) {
                throw new NotificationFailure(403, "USER_MISMATCH");
            }
        }
        if (consoleActor != null) {
            String claimed = request.getHeader("X-Console-Actor");
            if (claimed != null && !claimed.equals(consoleActor)) {
                throw new NotificationFailure(403, "CONSOLE_ACTOR_MISMATCH");
            }
            // 헤더가 «다른» 행위자를 말하면 조용히 무시하지 않고 거절한다. 무시하면 콘솔은 자기가
            // 보낸 이름으로 기록됐다고 믿는데 원장에는 다른 이름이 남아, 둘이 어긋난 사실을 아무도
            // 모른 채 감사가 계속된다. 헤더를 아예 안 보내는 것은 정상이다 — 행위자는 자격이 정한다.
            request.setAttribute("notification.actor", consoleActor);
        }
        request.setAttribute("notification.caller", caller);
        return true;
    }

    private static boolean matches(String authorization, String token) {
        return authorization != null && MessageDigest.isEqual(
                authorization.getBytes(StandardCharsets.UTF_8),
                ("Bearer " + token).getBytes(StandardCharsets.UTF_8));
    }

    static UUID delegatedUser(HttpServletRequest request) {
        try {
            return UUID.fromString(request.getHeader("X-User-Id"));
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(401, "USER_REQUIRED");
        }
    }
}
