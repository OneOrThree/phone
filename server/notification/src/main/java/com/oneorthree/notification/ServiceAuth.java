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
import java.util.Map;
import java.util.UUID;

@Configuration
class ServiceAuth implements WebMvcConfigurer, HandlerInterceptor {

    private final Map<String, String> tokens;

    ServiceAuth(@Value("${notification.tokens.business:}") String business,
            @Value("${notification.tokens.data:}") String data,
            @Value("${notification.tokens.console:}") String console) {
        require(business, "SVC_TOKEN_BIZ_TO_NOTI");
        require(data, "SVC_TOKEN_DATA_TO_NOTI");
        require(console, "SVC_TOKEN_CONSOLE_TO_NOTI");
        if (business.equals(data) || data.equals(console) || console.equals(business)) {
            throw new IllegalStateException("알림 caller 토큰은 서로 달라야 합니다");
        }
        tokens = Map.of("business", business, "data", data, "console", console);
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
        for (Map.Entry<String, String> entry : tokens.entrySet()) {
            if (authorization != null && MessageDigest.isEqual(authorization.getBytes(StandardCharsets.UTF_8),
                    ("Bearer " + entry.getValue()).getBytes(StandardCharsets.UTF_8))) {
                caller = entry.getKey();
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
                        && ("GET".equals(method) || "PUT".equals(method) || "PATCH".equals(method)))
                    || (path.matches("/internal/users/[0-9a-f-]{36}/notification-settings/initialized")
                        && "POST".equals(method))
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
        request.setAttribute("notification.caller", caller);
        return true;
    }

    static UUID delegatedUser(HttpServletRequest request) {
        try {
            return UUID.fromString(request.getHeader("X-User-Id"));
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(401, "USER_REQUIRED");
        }
    }
}
