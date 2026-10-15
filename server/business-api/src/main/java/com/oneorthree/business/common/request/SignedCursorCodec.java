package com.oneorthree.business.common.request;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * 버전·주체·필터·limit을 묶는 서명 커서. 키는 JWT와 별도이며 이전 검증 키를 만료창까지 유지한다.
 * 커서는 인가 증명이 아니다. 페이지를 읽을 때 현재 자원 권한을 별도로 검사해야 한다.
 */
public final class SignedCursorCodec {

    private static final int MAX_TOKEN_LENGTH = 4096;
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private final Map<String, byte[]> keys;
    private final String activeKey;
    private final Clock clock;
    private final Duration lifetime;
    private final ObjectMapper mapper;

    public SignedCursorCodec(Map<String, byte[]> signingKeys, String activeKey, Clock clock,
            Duration lifetime, ObjectMapper mapper) {
        this.keys = new HashMap<>();
        signingKeys.forEach((id, key) -> {
            if (!id.matches("[a-zA-Z0-9_-]{1,32}") || key.length < 32) {
                throw new IllegalArgumentException("커서 서명키 ID와 256비트 이상의 독립 키가 필요합니다.");
            }
            this.keys.put(id, key.clone());
        });
        if (!keys.containsKey(activeKey) || lifetime == null || lifetime.compareTo(Duration.ofSeconds(1)) < 0
                || lifetime.compareTo(Duration.ofMinutes(15)) > 0) {
            throw new IllegalArgumentException("활성 서명키와 1초~15분 만료창이 필요합니다.");
        }
        this.activeKey = activeKey;
        this.clock = Objects.requireNonNull(clock);
        this.lifetime = lifetime;
        this.mapper = Objects.requireNonNull(mapper);
    }

    public String encode(CursorScope scope, CursorBoundary boundary) {
        long issuedAt = clock.instant().getEpochSecond();
        Payload value = new Payload(1, scope.digest(), scope.sort(), boundary, issuedAt,
                Math.addExact(issuedAt, lifetime.toSeconds()));
        String body = ENCODER.encodeToString(mapper.writeValueAsBytes(value));
        String signed = activeKey + "." + body;
        return signed + "." + ENCODER.encodeToString(sign(keys.get(activeKey), signed));
    }

    /** null은 첫 페이지다. 빈/위조 커서를 첫 페이지로 조용히 바꾸지 않는다. 오류 field 는 {@code cursor} 다. */
    public CursorBoundary decode(String token, CursorScope expected) {
        return decode(token, expected, "cursor");
    }

    /**
     * 커서를 {@code cursor} 가 아닌 이름으로 받는 목록용 — 오류의 field 가 실제로 제출된 필드를 가리켜야 한다
     * (예: 공지 상세의 {@code commentsCursor}, GROMO-1771 island-board LLD §4).
     */
    public CursorBoundary decode(String token, CursorScope expected, String field) {
        if (token == null) {
            return null;
        }
        if (token.isEmpty() || token.length() > MAX_TOKEN_LENGTH) {
            throw invalid(field);
        }
        Payload value;
        try {
            String[] parts = token.split("\\.", -1);
            if (parts.length != 3 || !keys.containsKey(parts[0])
                    || !parts[1].matches("[A-Za-z0-9_-]+") || !parts[2].matches("[A-Za-z0-9_-]{43}")) {
                throw invalid(field);
            }
            byte[] signature = DECODER.decode(parts[2]);
            if (!ENCODER.encodeToString(signature).equals(parts[2])
                    || !MessageDigest.isEqual(sign(keys.get(parts[0]), parts[0] + "." + parts[1]), signature)) {
                throw invalid(field);
            }
            value = mapper.readValue(DECODER.decode(parts[1]), Payload.class);
            if (value.schemaVersion() != 1 || !expected.digest().equals(value.scopeDigest())
                    || !expected.sort().equals(value.sort()) || value.boundary() == null
                    || value.issuedAt() > clock.instant().getEpochSecond()
                    || value.expiresAt() <= value.issuedAt()
                    || value.expiresAt() - value.issuedAt() > Duration.ofMinutes(15).toSeconds()) {
                throw invalid(field);
            }
        } catch (PublicApiException e) {
            throw e;
        } catch (RuntimeException e) {
            // 요청 토큰/디코딩 원문은 예외 메시지와 로그에 싣지 않는다.
            throw invalid(field);
        }
        if (value.expiresAt() <= clock.instant().getEpochSecond()) {
            throw new PublicApiException(ApiErrorCode.CURSOR_EXPIRED, field);
        }
        return value.boundary();
    }

    private static byte[] sign(byte[] key, String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(body.getBytes(StandardCharsets.US_ASCII));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("커서 서명을 초기화할 수 없습니다.", e);
        }
    }

    private static PublicApiException invalid(String field) {
        return new PublicApiException(ApiErrorCode.INVALID_CURSOR, field);
    }

    public record Payload(int schemaVersion, String scopeDigest, String sort, CursorBoundary boundary,
            long issuedAt, long expiresAt) {
    }
}
