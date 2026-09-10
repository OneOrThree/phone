package com.oneorthree.chat.config;

import com.oneorthree.chat.auth.JwtValidator;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 서블릿 필터 등록.
 *
 * <p>{@link JwtFilter} 를 {@code @Component} 로 두지 않고 여기서 등록하는 이유는 <b>URL 패턴을
 * 좁히기 위해서</b>다. {@code @Component} 로 두면 Boot 가 모든 요청에 자동 등록해 {@code /ws/**}
 * 핸드셰이크와 {@code /actuator/**} 까지 401 이 된다.
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
}
