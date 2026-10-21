package com.oneorthree.phone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.security.SecureRandom;
import java.util.random.RandomGenerator;

/**
 * 서버 난수 빈 (GROMO-2301).
 *
 * <p>사용자가 결과를 미리 계산하지 못해야 하는 추첨(꾸미기 보상)은 공개 값(세션 id 등)을 씨앗으로 쓰지 않고 이 빈을
 * 주입받는다. {@link SecureRandom} 인 이유는 암호 강도가 아니라 예측 불가능성이다. 테스트는 고정 값을 내는 빈으로
 * 바꿔 끼운다({@link ClockConfig} 와 같은 결).
 */
@Configuration
public class RandomConfig {

    @Bean
    public RandomGenerator randomGenerator() {
        return new SecureRandom();
    }
}
