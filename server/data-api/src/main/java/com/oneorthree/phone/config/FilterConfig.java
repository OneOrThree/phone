package com.oneorthree.phone.config;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 내부 API의 서비스 인증과 요청 추적을 등록한다. */
@Configuration
@EnableConfigurationProperties(InternalApiProperties.class)
@RequiredArgsConstructor
public class FilterConfig {

    private final InternalApiProperties internalApiProperties;

    @Bean
    public FilterRegistrationBean<InternalAuthFilter> internalAuthFilter() {
        internalApiProperties.validateWhenEnabled();
        FilterRegistrationBean<InternalAuthFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new InternalAuthFilter(internalApiProperties));
        bean.addUrlPatterns("/internal/*");
        bean.setOrder(1);
        return bean;
    }

    @Bean
    public FilterRegistrationBean<TraceIdFilter> traceIdFilter() {
        FilterRegistrationBean<TraceIdFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new TraceIdFilter());
        bean.addUrlPatterns("/internal/*");
        bean.setOrder(2);
        return bean;
    }
}
