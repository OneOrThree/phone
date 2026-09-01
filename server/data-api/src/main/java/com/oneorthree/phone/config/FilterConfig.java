package com.oneorthree.phone.config;

import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserActivityService;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@RequiredArgsConstructor
public class FilterConfig {

    private final JwtProvider jwtProvider;
    private final UserActivityService userActivityService;
    private final UserRepository userRepository;

    @Bean
    public FilterRegistrationBean<JwtFilter> jwtFilter() {
        FilterRegistrationBean<JwtFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new JwtFilter(jwtProvider, userActivityService, userRepository));
        bean.addUrlPatterns("/api/*");
        bean.setOrder(1);
        return bean;
    }

    @Bean
    public FilterRegistrationBean<TraceIdFilter> traceIdFilter() {
        FilterRegistrationBean<TraceIdFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new TraceIdFilter());
        bean.addUrlPatterns("/api/*");
        bean.setOrder(2);
        return bean;
    }

    /**
     * 모더레이션 상한(와이어 바이트).
     *
     * <p>{@code ImageModerationRequest} 의 {@code @Size} 는 디코드된 base64 '문자열 길이'(≈10MiB)를 재지만
     * 필터가 보는 Content-Length 는 '와이어 바이트'다. JSON 직렬화가 base64 의 '/' 를 '\/' 로 이스케이프하면
     * 와이어가 문자열보다 커지므로('/' 비중 ~1.6% → 최대 수백 KB 증가), {@code @Size} 를 통과할 정상 요청이
     * 좁은 한도에 걸려 413 이 나는 걸 막기 위해 와이어 한도를 넉넉히(12MiB) 둔다.
     */
    private static final long MODERATION_MAX_WIRE_BYTES = 12L * 1024 * 1024;

    /**
     * 집중 세션 저장/종료 상한(와이어 바이트) — GROMO-1252 코드리뷰 5차 ④.
     *
     * <p>이 경로의 본문은 {@code focusSecondsByDate} 맵이 지배한다. 엔트리 1개는 최악
     * {@code "2026-08-08":2147483647,} = 25바이트이고 엔트리 수는 32개로 캡되어 있어(400 검증)
     * 맵이 최대 800바이트, 나머지 필드(UUID 2개·Instant 2개·int·enum)를 더해도 정상 본문은 1KiB 안팎이다.
     * 8KiB 는 그 8배로, 공백을 넣어 보내는 클라도 걸리지 않으면서 {@code @Size} 검증 전에 힙을 태우는
     * 대량 본문(수 MB 짜리 맵)은 확실히 끊는 값이다.
     */
    private static final long FOCUS_SESSION_MAX_WIRE_BYTES = 8L * 1024;

    /**
     * 본문 크기 가드 — 역직렬화 전 차단이 목적이라 JWT(1)·TraceId(2)보다 먼저 돈다.
     * 지정한 엔드포인트에만 적용해 다른 경로의 본문엔 영향이 없다.
     */
    @Bean
    public FilterRegistrationBean<RequestSizeLimitFilter> moderationRequestSizeFilter() {
        return sizeLimit(MODERATION_MAX_WIRE_BYTES, "/api/v1/character/moderation");
    }

    /**
     * 집중 세션 완료 저장(POST)·라이브 종료(PATCH) — 둘 다 같은 URL 이라 한 패턴으로 덮인다.
     * /focus-session/start·/cancel 은 분포 맵이 없는 소형 본문이라 대상이 아니다.
     */
    @Bean
    public FilterRegistrationBean<RequestSizeLimitFilter> focusSessionRequestSizeFilter() {
        return sizeLimit(FOCUS_SESSION_MAX_WIRE_BYTES, "/api/v1/focus-session");
    }

    private static FilterRegistrationBean<RequestSizeLimitFilter> sizeLimit(long maxWireBytes, String... urlPatterns) {
        FilterRegistrationBean<RequestSizeLimitFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new RequestSizeLimitFilter(maxWireBytes));
        bean.addUrlPatterns(urlPatterns);
        bean.setOrder(0);
        return bean;
    }
}
