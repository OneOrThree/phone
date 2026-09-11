package com.oneorthree.business.config;

import com.oneorthree.business.common.request.SignedCursorCodec;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/** 신규 목록 활성화 시 독립 키를 필수로 주입한다. JWT 키를 커서 서명에 재사용하지 않는다. */
@Configuration
@ConditionalOnProperty(prefix = "business.cursor", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(CursorConfig.Properties.class)
public class CursorConfig {

    @Bean
    public SignedCursorCodec signedCursorCodec(Properties properties, ObjectMapper mapper) {
        Map<String, byte[]> keys = new HashMap<>();
        properties.keys().forEach((id, encoded) -> keys.put(id, Base64.getDecoder().decode(encoded)));
        return new SignedCursorCodec(keys, properties.activeKey(), Clock.systemUTC(),
                Duration.ofMinutes(15), mapper);
    }

    @ConfigurationProperties(prefix = "business.cursor")
    public record Properties(String activeKey, Map<String, String> keys) {
        public Properties {
            keys = keys == null ? Map.of() : Map.copyOf(keys);
        }
    }
}
