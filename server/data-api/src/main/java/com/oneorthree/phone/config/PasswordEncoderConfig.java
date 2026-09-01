package com.oneorthree.phone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 해시 인코더 등록. spring-boot-starter-security 는 넣지 않고 {@code spring-security-crypto} 만
 * 의존하므로 Boot 의 시큐리티 자동 구성이 붙지 않는다 — 인증은 전적으로 {@link JwtFilter} 가 맡고,
 * 여기서 등록하는 건 해시 유틸 하나뿐이다.
 */
@Configuration
public class PasswordEncoderConfig {
    /**
     * BCrypt 인코더(강도는 라이브러리 기본값 10). 검증은 해시에 박힌 파라미터를 따라가므로
     * 나중에 강도를 올려도 기존 해시는 그대로 매칭된다.
     *
     * @return 애플리케이션 전역에서 공유하는 BCrypt 인코더
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}


