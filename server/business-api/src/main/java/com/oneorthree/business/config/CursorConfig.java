package com.oneorthree.business.config;

import com.oneorthree.business.common.http.RequiredConfig;
import com.oneorthree.business.common.request.SignedCursorCodec;
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

/**
 * 목록 커서 서명기 — 항상 만든다(2026-10-27, 티켓 2535 — {@code business.cursor.enabled} 를 걷었다). 독립 키는 필수이고
 * JWT 키를 커서 서명에 재사용하지 않는다.
 *
 * <p>키가 없거나 치환되지 않았거나 짧으면 «부팅이 실패»한다({@link RequiredConfig} fail-fast) — 종전처럼 부팅은 정상이고
 * 목록의 첫 요청만 503 이 되는 모양이 없다.
 */
@Configuration
@EnableConfigurationProperties(CursorConfig.Properties.class)
public class CursorConfig {

    @Bean
    public SignedCursorCodec signedCursorCodec(Properties properties, ObjectMapper mapper) {
        String activeKey = RequiredConfig.require(properties.activeKey(), "business.cursor.active-key");
        Map<String, byte[]> keys = new HashMap<>();
        properties.keys().forEach((id, encoded) -> keys.put(id, decode(id, encoded)));
        if (!keys.containsKey(activeKey)) {
            throw new IllegalStateException("business.cursor.keys." + activeKey + " 미설정 — active-key 가 가리키는 서명키가 없다");
        }
        return new SignedCursorCodec(keys, activeKey, Clock.systemUTC(), Duration.ofMinutes(15), mapper);
    }

    /** 키 원문은 메시지에 넣지 않는다 — 설정 이름만 담는다. */
    private static byte[] decode(String id, String encoded) {
        String what = "business.cursor.keys." + id;
        String resolved = RequiredConfig.require(encoded, what);
        byte[] key;
        try {
            key = Base64.getDecoder().decode(resolved);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(what + " 는 base64 가 아니다");
        }
        if (key.length < SignedCursorCodec.MIN_KEY_BYTES) {
            throw new IllegalStateException(what + " 가 " + SignedCursorCodec.MIN_KEY_BYTES * 8 + "비트보다 짧다");
        }
        return key;
    }

    @ConfigurationProperties(prefix = "business.cursor")
    public record Properties(String activeKey, Map<String, String> keys) {
        public Properties {
            keys = keys == null ? Map.of() : Map.copyOf(keys);
        }
    }
}
