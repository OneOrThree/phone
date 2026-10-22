package com.oneorthree.phone.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.EnumerablePropertySource;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 배포되는 {@code application-satellites.yml} 허용목록에 LINK 대상 endpoint 가 하나도 없는지 본다 (GROMO-2407).
 *
 * <p>겨냥하는 실패: link.* 를 받는 서버가 없다. endpoint 를 하나라도 되살리면 LINK transport 가 생겨, 그 키의 행은
 * 404 로, 나머지 키의 행은 「허용목록에 없는 엔드포인트」로 영구 실패를 무한 재시도한다. 받는 서버가 생겨 되살릴 때는
 * 이 테스트를 7종 전부를 확인하는 쪽으로 바꾼다.
 */
class LinkOutboxEndpointsTest {

    @Test
    @DisplayName("LINK 대상 endpoint 는 하나도 없다 — 받는 서버가 없어 되살리면 영구 실패가 돈다")
    void noEndpointTargetsLink() throws IOException {
        EnumerablePropertySource<?> yml = (EnumerablePropertySource<?>) new YamlPropertySourceLoader()
                .load("satellites", new ClassPathResource("application-satellites.yml")).get(0);

        assertThat(Arrays.stream(yml.getPropertyNames())
                .filter(name -> name.startsWith("outbox.relay.endpoints[") && name.endsWith("].target")))
                .as("endpoint 목록을 실제로 읽었다").isNotEmpty()
                // 바인더는 enum 을 대소문자 구분 없이 받는다 — `target: link` 도 LINK transport 를 만든다.
                .allSatisfy(name -> assertThat(String.valueOf(yml.getProperty(name))).as(name)
                        .isNotEqualToIgnoringCase("LINK"));
    }
}
