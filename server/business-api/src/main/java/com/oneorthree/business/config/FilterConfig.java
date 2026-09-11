package com.oneorthree.business.config;

import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.common.api.ApiResponses;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 서블릿 필터 등록 — <b>순서와 적용 범위가 곧 보안 경계</b>다.
 *
 * <h2>왜 {@code @Component} 가 아니라 여기서 등록하나</h2>
 * <p>{@code @Component} 로 두면 등록 순서를 Boot 가 정하고, 두 필터의 앞뒤가 바뀌면 본문 상한이 인증
 * 뒤로 밀려 무인증 경로가 상한 없이 열린다. 순서를 코드에 못 박는다.
 *
 * <h2>둘 다 {@code /*} 다</h2>
 * <ul>
 *   <li>{@link RequestEnvelopeFilter}(order 0) — 추적 id · 캐시 금지 · 본문 256KiB. 공개 경로에도
 *       적용돼야 하므로 인증보다 앞이다.</li>
 *   <li>{@link AccessTokenFilter}(order 1) — <b>전부 막고</b> 자기 {@code PUBLIC_PATHS} 에 정확히
 *       일치하는 것만 통과시킨다. URL 패턴을 {@code /api/*} 로 좁히면 {@code /%61pi/...} ·
 *       {@code /api;v=1/...} 처럼 <b>MVC 는 같은 컨트롤러로 보내는데 필터 패턴에는 안 걸리는</b> 변형이
 *       무인증으로 통과한다. 그래서 범위는 넓게 잡고 예외를 좁게 열거한다.</li>
 * </ul>
 *
 * <p>무인증으로 남는 것: {@code /health}(컨테이너 헬스체크) · {@code /l/match}(정지 창의 구 앱 매치 —
 * 그 경로에 닿는 사람은 아직 우리 유저가 아니고, 인증을 붙이면 구 앱의 deferred 매치가 전멸한다) ·
 * {@code /actuator/*}(포트 9091 격리. 서비스 포트로 부르면 404 여야 한다).
 */
@Configuration
public class FilterConfig {

    @Bean
    public FilterRegistrationBean<RequestEnvelopeFilter> requestEnvelopeFilterRegistration(ApiResponses responses) {
        FilterRegistrationBean<RequestEnvelopeFilter> registration =
                new FilterRegistrationBean<>(new RequestEnvelopeFilter(responses));
        registration.addUrlPatterns("/*");
        registration.setOrder(0);
        return registration;
    }

    @Bean
    public FilterRegistrationBean<AccessTokenFilter> accessTokenFilterRegistration(
            AccessTokenVerifier verifier, ApiResponses responses) {
        FilterRegistrationBean<AccessTokenFilter> registration =
                new FilterRegistrationBean<>(new AccessTokenFilter(verifier, responses));
        registration.addUrlPatterns("/*");
        registration.setOrder(1);
        return registration;
    }
}
