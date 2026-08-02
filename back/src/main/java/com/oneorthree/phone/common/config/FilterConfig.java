package com.oneorthree.phone.common.config;

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

    // 모더레이션 요청 본문 크기 가드 — 역직렬화 전 차단이 목적이라 JWT(1)·TraceId(2)보다 먼저 돈다.
    // 해당 엔드포인트에만 적용해 다른 경로의 본문엔 영향이 없다.
    @Bean
    public FilterRegistrationBean<ModerationRequestSizeFilter> moderationRequestSizeFilter() {
        FilterRegistrationBean<ModerationRequestSizeFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new ModerationRequestSizeFilter());
        bean.addUrlPatterns("/api/v1/character/moderation");
        bean.setOrder(0);
        return bean;
    }
}
