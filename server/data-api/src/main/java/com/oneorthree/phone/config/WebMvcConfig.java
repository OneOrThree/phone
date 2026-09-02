package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.LoginUserArgumentResolver;
import com.oneorthree.phone.stats.dto.FocusAverageScope;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/**
 * Spring MVC 전역 설정.
 * Converter 등록(소문자 period 파라미터 → StatsPeriod enum 변환 등)을 담당한다.
 */
@Configuration
@RequiredArgsConstructor
public class WebMvcConfig implements WebMvcConfigurer {

    private final LoginUserArgumentResolver loginUserArgumentResolver;
    private final LegacyBetBridgeLogInterceptor legacyBetBridgeLogInterceptor;

    /**
     * 레거시 내기 브리지(N36) 사용량 계측 — 인자 검증 전에 찍어야 400/403 으로 떨어지는 구앱
     * 호출까지 집계된다(GROMO-1418, 제거 판단은 GROMO-1238).
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(legacyBetBridgeLogInterceptor)
                .addPathPatterns(LegacyBetBridgeLogInterceptor.PATH_PATTERNS);
    }

    /**
     * 커스텀 리졸버는 내장 리졸버들 *뒤에*, catch-all 앞에서 탐색된다 (GROMO-363).
     * 이 등록을 빠뜨리면 에러가 아니라 catch-all 이 @LoginUser UUID 를 쿼리 파라미터로 해석해
     * 조용히 null 이 주입되거나 ?userId= 로 사칭이 가능해진다 — 리졸버 본체만큼 중요한 한 줄이다.
     */
    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(loginUserArgumentResolver);
    }

    @Override
    public void addFormatters(FormatterRegistry registry) {
        // 클라이언트가 소문자(day|week|month)로 전송하므로 대문자 변환 후 enum 매핑.
        // 지원하지 않는 값은 IllegalArgumentException → MethodArgumentTypeMismatchException → 400.
        // toUpperCase 는 반드시 Locale.ROOT — 터키어 로케일에서 'i' → 'İ' 로 대문자화돼 enum 매핑이 깨지는 것 방지.
        registry.addConverter(String.class, StatsPeriod.class,
                s -> StatsPeriod.valueOf(s.toUpperCase(java.util.Locale.ROOT)));
        // 평균 집중 API(GROMO-753) scope 파라미터도 소문자(friends|total|category) 허용 — period 와 동일 관례.
        registry.addConverter(String.class, FocusAverageScope.class,
                s -> FocusAverageScope.valueOf(s.toUpperCase(java.util.Locale.ROOT)));
    }
}
