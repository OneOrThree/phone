package com.oneorthree.realtime.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.Base64;
import java.util.Date;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * Access Token 을 로컬에서 검증한다 — 서명·만료·{@code type} 클레임 세 가지를 한 번에 본다.
 *
 * <p><b>검증만 한다. 발급하지 않는다.</b> 토큰을 만드는 주체는 Data API 하나뿐이고, 채팅은 같은
 * {@code jwt.secret} 으로 서명을 확인할 뿐이다. 이 클래스에 발급 메서드를 더하는 순간 서명 주체가
 * 둘이 되어 «어느 서버가 발급한 토큰인가»를 아무도 답할 수 없게 된다.
 *
 * <p><b>type 가드가 핵심 계약이다.</b> access 와 refresh 는 같은 키로 서명되므로 서명 검증만으로는
 * 구분되지 않는다. refresh(수명 30일)로 채팅에 붙을 수 있게 되면 access 1시간 만료 정책이 통째로
 * 무력화된다 — 그래서 {@code type=access} 가 아닌 토큰은 서명이 맞아도 거절한다. 비교를 상수 쪽에서
 * 시작해 클레임이 없는 구 토큰({@code null})도 NPE 없이 거절된다(fail-closed).
 *
 * <p><b>legacy extractUserId의 알려진 한계(기본 OFF 모드)</b> — 탈퇴 유저를 걸러내지 못한다.
 * Data API 의 {@code JwtFilter} 는 매 요청
 * {@code users.is_deleted} 를 확인하지만 채팅에는 유저 테이블이 없다. 따라서 탈퇴 직전에 발급된 AT 로
 * 최대 만료까지(기본 1시간) 채팅에 붙을 수 있다. 다만 탈퇴는 그룹 멤버십도 정리하므로 실제 영향은
 * 멤버십 캐시 TTL(설정 기본120초) 안쪽으로 좁혀지고, 그 뒤에는 {@code NOT_A_MEMBER} 로 막힌다.
 * 신규 opt-in 그룹별 관문은 strict sid/gen과 Data 현재 판정을 추가하지만
 * CONNECT 등 이 메서드만 쓰는 경계까지 강화됐다는 뜻은 아니다.
 */
@Slf4j
@Component
public class JwtValidator {

    /** 이 값을 가진 토큰만 채팅에 붙을 수 있다. Data API 의 {@code JwtProvider.TYPE_ACCESS} 와 같은 문자열이다. */
    public static final String TYPE_ACCESS = "access";

    private static final String CLAIM_TYPE = "type";

    private final SecretKey secretKey;
    private final Clock clock;
    private static final JsonMapper STRICT_JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    /**
     * @param secret HMAC-SHA 서명키 원문. 비어 있으면 부팅을 실패시킨다 — 런타임에 발견하면 그때는 이미
     *               서명 검증 없이 뜬 서버가 돌고 있다. Data API 와 <b>같은 값</b>이어야 하며, 길이가
     *               알고리즘 최소치(HS256 기준 32바이트)에 못 미치면 {@code Keys.hmacShaKeyFor} 가 거부한다
     */
    public JwtValidator(String secret) {
        this(secret, Clock.systemUTC());
    }

    @Autowired
    public JwtValidator(@Value("${jwt.secret}") String secret, Clock clock) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("jwt.secret 미설정");
        }
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.clock = java.util.Objects.requireNonNull(clock);
    }

    /**
     * 토큰에서 userId 를 꺼낸다 — 서명·만료·type 이 모두 맞을 때만.
     *
     * <p>예외를 밖으로 전파하지 않고 {@code Optional.empty()} 로 접는 이유는 호출부가 셋(REST 필터,
     * STOMP CONNECT, 테스트)인데 <b>셋 다 실패를 같은 방식으로 다루기 때문</b>이다 — 거절. 구분해서 다룰
     * 곳이 없는 예외를 타입으로 남겨 두면 호출부마다 catch 를 복붙하게 되고, 그중 하나가 빠지면 그 경로만
     * 500 이 된다.
     *
     * @param token {@code Bearer } 접두를 <b>이미 떼어낸</b> 토큰 문자열. null 이면 빈 값을 돌려준다
     * @return 유효한 access 토큰이면 subject 의 userId, 그 밖에는 전부 empty
     */
    public Optional<UUID> extractUserId(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            // 상수를 왼쪽에 둔다 — type 클레임이 없는 구 토큰은 null 이고, 그때도 NPE 없이 false 가 된다.
            if (!TYPE_ACCESS.equals(claims.get(CLAIM_TYPE, String.class))) {
                return Optional.empty();
            }
            return Optional.of(UUID.fromString(claims.getSubject()));
        } catch (JwtException | IllegalArgumentException e) {
            // 서명 불일치·만료·subject 가 UUID 가 아님. 어느 쪽이든 결론은 같아서 구분하지 않는다.
            // 토큰 문자열 자체는 절대 로그에 남기지 않는다 — 로그 수집기로 흘러가면 그게 곧 자격증명 유출이다.
            log.debug("토큰 검증 실패 — {}", e.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    /** 신규 현재 인가 전용. legacy extractUserId의 claim 수용 범위를 바꾸지 않는다. */
    public Optional<VerifiedAccessIdentity> extractSessionProof(String token) {
        if (token == null || token.isBlank() || token.length() > 8192) {
            return Optional.empty();
        }
        try {
            String[] parts = token.split("\\.", -1);
            if (parts.length != 3) {
                return Optional.empty();
            }
            JsonNode header = STRICT_JSON.readTree(Base64.getUrlDecoder().decode(parts[0]));
            // 현재 issuer는 압축 JWT를 발급하지 않는다. 검증 전 압축 해제/크기 증폭을 열지 않는다.
            if (header == null || !header.isObject() || header.has("zip")) {
                return Optional.empty();
            }
            Jwts.parser().verifyWith(secretKey).clock(() -> Date.from(clock.instant())).build()
                    .parseSignedClaims(token);
            // JJWT가 exp를 Date로 변환하기 전 wire 타입도 검사한다. 서명된 같은 payload만 읽는다.
            JsonNode claims = STRICT_JSON.readTree(Base64.getUrlDecoder().decode(parts[1]));
            if (claims == null || !claims.isObject() || !claims.path("type").isTextual()
                    || !TYPE_ACCESS.equals(claims.path("type").stringValue())) {
                return Optional.empty();
            }
            UUID userId = strictUuid(claims.get("sub"));
            UUID sessionId = strictUuid(claims.get("sid"));
            JsonNode generation = claims.get("gen");
            JsonNode expiration = claims.get("exp");
            if (generation == null || !generation.isIntegralNumber() || !generation.canConvertToLong()
                    || expiration == null || !expiration.isIntegralNumber() || !expiration.canConvertToLong()) {
                return Optional.empty();
            }
            Instant expiresAt = Instant.ofEpochSecond(expiration.longValue());
            if (!expiresAt.isAfter(clock.instant())) {
                return Optional.empty();
            }
            return Optional.of(new VerifiedAccessIdentity(userId, sessionId, generation.longValue(), expiresAt));
        } catch (RuntimeException e) {
            // JWT/JSON 예외에 token·subject 원문이 들어갈 수 있어 메시지/원인은 기록하지 않는다.
            return Optional.empty();
        }
    }

    private static UUID strictUuid(JsonNode value) {
        if (value == null || !value.isTextual() || value.stringValue().length() != 36) {
            throw new IllegalArgumentException("세션 식별자가 올바르지 않습니다.");
        }
        UUID result = UUID.fromString(value.stringValue());
        if (!result.toString().equalsIgnoreCase(value.stringValue())) {
            throw new IllegalArgumentException("세션 식별자가 올바르지 않습니다.");
        }
        return result;
    }

}
