package com.oneorthree.phone.config;

import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserActivityService;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 서블릿 필터 등록 — 모두 {@code /api/*} 에만 걸리므로 {@code /link/**}(초대 링크 랜딩)·
 * {@code /.well-known/**}·actuator 같은 공개 경로는 어떤 필터도 거치지 않는다.
 *
 * <p>order 는 작을수록 먼저 돈다: 본문 크기 가드(0) → {@link JwtFilter}(1) → {@link TraceIdFilter}(2).
 * TraceId 가 JWT 뒤인 건 의도적이다 — 인증이 request 에 심은 userId 를 읽어 MDC 에 넣기 때문에
 * 순서를 뒤집으면 트레이스에서 유저 식별이 빠진다.
 */
@Configuration
@RequiredArgsConstructor
public class FilterConfig {

    private final JwtProvider jwtProvider;
    private final UserActivityService userActivityService;
    private final UserRepository userRepository;

    /**
     * 인증 필터를 {@code /api/*} 에만 order 1 로 건다.
     *
     * <p>필터 자체는 Spring 빈이 아니라 여기서 직접 {@code new} 로 만들어 등록한다 —
     * 컴포넌트 스캔에 걸리면 Boot 가 모든 경로에 자동 등록해 URL 패턴 한정이 무너지기 때문이다.
     *
     * @return {@code /api/*} 한정·order 1 로 설정된 {@link JwtFilter} 등록 빈
     */
    @Bean
    public FilterRegistrationBean<JwtFilter> jwtFilter() {
        FilterRegistrationBean<JwtFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new JwtFilter(jwtProvider, userActivityService, userRepository));
        bean.addUrlPatterns("/api/*");
        bean.setOrder(1);
        return bean;
    }

    /**
     * 로그 상관관계 필터를 {@code /api/*} 에 order 2 로 건다 — {@link JwtFilter}(1) 다음이어야 한다.
     * 인증이 request 에 심어 둔 userId 를 읽어 MDC {@code user_id} 로 올리기 때문에,
     * 앞으로 당기면 로그에서 유저 식별이 사라진다.
     *
     * @return {@code /api/*} 한정·order 2 로 설정된 {@link TraceIdFilter} 등록 빈
     */
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
     *
     * @return 캐릭터 모더레이션 경로에만 12MiB 와이어 한도를 거는 order 0 등록 빈
     */
    @Bean
    public FilterRegistrationBean<RequestSizeLimitFilter> moderationRequestSizeFilter() {
        return sizeLimit(MODERATION_MAX_WIRE_BYTES, "/api/v1/character/moderation");
    }

    /**
     * 집중 세션 완료 저장(POST)·라이브 종료(PATCH) — 둘 다 같은 URL 이라 한 패턴으로 덮인다.
     * /focus-session/start·/cancel 은 분포 맵이 없는 소형 본문이라 대상이 아니다.
     *
     * @return 집중 세션 저장·종료 경로에만 8KiB 와이어 한도를 거는 order 0 등록 빈
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
