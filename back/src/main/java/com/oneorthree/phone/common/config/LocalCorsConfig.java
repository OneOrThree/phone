package com.oneorthree.phone.common.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/** 로컬 웹 디버깅 서버에서 localhost 백엔드를 호출하기 위한 CORS 설정. */
@Configuration
@Profile("local")
public class LocalCorsConfig {

    @Bean
    public FilterRegistrationBean<CorsFilter> localCorsFilter() {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOriginPatterns(List.of("http://localhost:*", "http://127.0.0.1:*"));
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("*"));
        cors.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);

        FilterRegistrationBean<CorsFilter> bean = new FilterRegistrationBean<>(new CorsFilter(source));
        // 인증 필터보다 먼저 preflight 요청을 처리해야 OPTIONS 요청이 401로 차단되지 않는다.
        bean.setOrder(Integer.MIN_VALUE);
        return bean;
    }
}
