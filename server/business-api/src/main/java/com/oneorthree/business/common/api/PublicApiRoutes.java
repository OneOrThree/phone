package com.oneorthree.business.common.api;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.server.PathContainer;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

import java.util.List;

/** 응답 계약 선택 전용. 이 목록은 인증 허용목록이 아니다. */
public final class PublicApiRoutes {

    private static final List<PathPattern> ROOTS = List.of(
            "/auth/sessions/**", "/me/**", "/islands/**", "/focus-sessions/**", "/invitations/**",
            "/rankings/**", "/statistics/**", "/screens/**", "/link-previews/**")
            .stream().map(PathPatternParser.defaultInstance::parse).toList();

    private PublicApiRoutes() {
    }

    public static boolean usesEnvelope(HttpServletRequest request) {
        Object original = request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);
        String uri = original instanceof String path ? path : request.getRequestURI();
        String context = request.getContextPath();
        if (!context.isEmpty() && uri.startsWith(context + "/")) {
            uri = uri.substring(context.length());
        }
        try {
            PathContainer path = PathContainer.parsePath(uri);
            return ROOTS.stream().anyMatch(pattern -> pattern.matches(path));
        } catch (IllegalArgumentException ignored) {
            // 잘못 인코딩한 URI를 인증 예외나 다른 경로로 정규화하지 않는다.
            return false;
        }
    }
}
