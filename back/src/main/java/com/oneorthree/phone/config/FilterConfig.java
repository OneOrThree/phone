package com.oneorthree.phone.config;

import com.oneorthree.phone.service.JwtProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@RequiredArgsConstructor
public class FilterConfig {

    private final JwtProvider jwtProvider;

    @Bean
    public FilterRegistrationBean<JwtFilter> jwtFilter() {
        FilterRegistrationBean<JwtFilter> bean = new FilterRegistrationBean<>();

        bean.setFilter(new JwtFilter(jwtProvider));

        bean.addUrlPatterns("/api/*");

        bean.setOrder(1);

        return bean;
    }
}
