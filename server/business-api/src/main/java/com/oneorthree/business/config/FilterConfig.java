package com.oneorthree.business.config;

import com.oneorthree.business.auth.AccessTokenVerifier;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 서블릿 필터 등록.
 *
 * <p>{@link AccessTokenFilter} 를 {@code @Component} 로 두지 않고 여기서 등록하는 이유는 <b>URL 패턴을
 * 좁히기 위해서</b>다. {@code @Component} 로 두면 Boot 가 모든 요청에 자동 등록해 {@code /actuator/**}
 * 와 이관 정지 창의 무인증 {@code /l/match} 까지 401 이 된다.
 *
 * <p><b>{@code /l/*} 를 일부러 뺀다</b> — 그 경로에 도달하는 사람은 아직 우리 유저가 아니고(설치 직후
 * 첫 실행), 현 {@code LinkPublicController} 도 무인증이다. 인증을 붙이면 구 앱의 deferred 매치가
 * 전멸한다. 대신 그 핸들러는 방문자 입력을 그대로 상류에 넘기지 않고, 기본값이 «꺼짐»이다.
 */
@Configuration
public class FilterConfig {

    @Bean
    public FilterRegistrationBean<AccessTokenFilter> accessTokenFilterRegistration(
            AccessTokenVerifier verifier) {
        FilterRegistrationBean<AccessTokenFilter> registration =
                new FilterRegistrationBean<>(new AccessTokenFilter(verifier));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(1);
        return registration;
    }
}
