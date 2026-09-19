package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.JwtValidator;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 서블릿 필터 등록.
 *
 * <p>{@link JwtFilter} 를 {@code @Component} 로 두지 않고 여기서 등록하는 이유는 <b>URL 패턴을
 * 좁히기 위해서</b>다. {@code @Component} 로 두면 Boot 가 모든 요청에 자동 등록해 {@code /ws/**}
 * 핸드셰이크와 {@code /actuator/**} 까지 401 이 된다.
 *
 * <p>{@link InternalServiceTokenFilter} 도 같은 이유로 {@code /internal/*} 에만 건다. 두 필터의
 * URL 패턴이 겹치지 않는 것이 계약이다 — 겹치면 한 요청이 앱 AT 와 서비스 토큰을 «둘 다» 요구받는다.
 */
@Configuration
public class FilterConfig {

    @Bean
    public FilterRegistrationBean<JwtFilter> jwtFilterRegistration(JwtValidator jwtValidator) {
        FilterRegistrationBean<JwtFilter> registration = new FilterRegistrationBean<>(new JwtFilter(jwtValidator));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(1);
        return registration;
    }

    /**
     * 우체통 내부 어댑터의 자격 관문 (island-mailbox LLD §3). 토큰은 {@code SVC_TOKEN_BIZ_TO_REALTIME}
     * 하나 — Business 가 Data·알림·링크에 쓰는 토큰과 «분리»돼 있어야 한다(A22 ㊀).
     */
    @Bean
    public FilterRegistrationBean<InternalServiceTokenFilter> internalServiceTokenFilterRegistration(
            @Value("${realtime.internal.service-token:}") String serviceToken) {
        FilterRegistrationBean<InternalServiceTokenFilter> registration =
                new FilterRegistrationBean<>(new InternalServiceTokenFilter(serviceToken));
        registration.addUrlPatterns("/internal/*");
        registration.setOrder(1);
        return registration;
    }

    /**
     * Data 사건 수신구({@code POST /internal/events}, GROMO-1943)의 자격 관문. 토큰은
     * {@code SVC_TOKEN_DATA_TO_REALTIME} — Business 토큰과 분리돼 있어야 한다(A22 ㊀). 위의 Business 필터는
     * 이 경로를 건너뛰므로 한 요청이 두 토큰을 요구받지 않는다.
     */
    @Bean
    public FilterRegistrationBean<InternalServiceTokenFilter> dataEventTokenFilterRegistration(
            @Value("${realtime.internal.data-service-token:}") String serviceToken) {
        FilterRegistrationBean<InternalServiceTokenFilter> registration =
                new FilterRegistrationBean<>(new InternalServiceTokenFilter(serviceToken, false));
        // 같은 필터 클래스의 두 번째 등록이다 — 이름을 따로 주지 않으면 컨테이너가 «이미 등록됨»으로 건너뛴다.
        registration.setName("dataEventTokenFilter");
        registration.addUrlPatterns(InternalServiceTokenFilter.DATA_EVENTS_PATH);
        registration.setOrder(1);
        return registration;
    }
}
