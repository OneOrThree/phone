package com.oneorthree.phone.config;

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

    /**
     * localhost·127.0.0.1 의 임의 포트에서 오는 요청만 허용하는 CORS 필터. {@code local} 프로파일에만
     * 등록되므로 dev·prod 에는 이 빈 자체가 없다.
     *
     * <p>적용 경로는 {@code /api/**} 와 {@code /l/**} 둘이다 — 설치 전 초대 복원(POST /l/match)이
     * {@code /api} 밖이라 빠뜨리면 preflight 응답에 CORS 헤더가 없어 로컬 웹에서 조용히 실패한다.
     *
     * <p>order 는 {@code Integer.MIN_VALUE} — 인증 필터(1)를 포함해 무엇보다 먼저 돌아야
     * Authorization 헤더가 없는 OPTIONS preflight 가 401 로 잘리지 않는다.
     *
     * @return 로컬 오리진 한정 CORS 필터를 최우선 순서로 등록하는 빈
     */
    @Bean
    public FilterRegistrationBean<CorsFilter> localCorsFilter() {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOriginPatterns(List.of("http://localhost:*", "http://127.0.0.1:*"));
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("*"));
        cors.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);
        // 설치 전 초대 복원(POST /l/match)은 /api 밖이라 여기 없으면 preflight 에 CORS 헤더가
        // 붙지 않아 로컬 웹에서 조용히 실패한다 (코드리뷰).
        source.registerCorsConfiguration("/l/**", cors);

        FilterRegistrationBean<CorsFilter> bean = new FilterRegistrationBean<>(new CorsFilter(source));
        // 인증 필터보다 먼저 preflight 요청을 처리해야 OPTIONS 요청이 401로 차단되지 않는다.
        bean.setOrder(Integer.MIN_VALUE);
        return bean;
    }
}
