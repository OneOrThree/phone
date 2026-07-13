package com.oneorthree.phone.common.config;

import com.oneorthree.phone.stats.dto.FocusAverageScope;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import org.springframework.context.annotation.Configuration;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Spring MVC 전역 설정.
 * Converter 등록(소문자 period 파라미터 → StatsPeriod enum 변환 등)을 담당한다.
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addFormatters(FormatterRegistry registry) {
        // 클라이언트가 소문자(day|week|month)로 전송하므로 대문자 변환 후 enum 매핑.
        // 지원하지 않는 값은 IllegalArgumentException → MethodArgumentTypeMismatchException → 400.
        registry.addConverter(String.class, StatsPeriod.class,
                s -> StatsPeriod.valueOf(s.toUpperCase()));
        // 평균 집중 API(GROMO-753) scope 파라미터도 소문자(friends|total|category) 허용 — period 와 동일 관례.
        registry.addConverter(String.class, FocusAverageScope.class,
                s -> FocusAverageScope.valueOf(s.toUpperCase()));
    }
}
