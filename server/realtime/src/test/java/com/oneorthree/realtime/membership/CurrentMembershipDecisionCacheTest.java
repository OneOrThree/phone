package com.oneorthree.realtime.membership;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.config.RealtimeAuthorizationProperties;
import com.oneorthree.realtime.membership.client.RealtimeMembershipAuthorizationClient;
import com.oneorthree.realtime.message.exception.ChatException;
import com.sun.net.httpserver.HttpServer;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 JWT→HTTP 경로 위에서 허용 결정 캐시의 hit·miss·TTL·evict·거절 비캐시를 본다. */
class CurrentMembershipDecisionCacheTest {
    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256";
    private final UUID user = UUID.randomUUID();
    private final UUID island = UUID.randomUUID();
    private final AtomicInteger calls = new AtomicInteger();
    private final AtomicBoolean allowed = new AtomicBoolean(true);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private HttpServer server;
    private RealtimeAuthorizationProperties properties;
    private JwtValidator jwt;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/realtime/membership-authorization", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            byte[] bytes = ("{\"allowed\":" + allowed.get() + "}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (var out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
        properties = new RealtimeAuthorizationProperties();
        properties.setEnabled(true);
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setServiceToken("test-current-membership-service");
        jwt = new JwtValidator(SECRET, Clock.systemUTC());
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private CurrentMembershipVerifier verifier(CurrentMembershipDecisionCache cache) {
        return new CurrentMembershipVerifier(jwt,
                new RealtimeMembershipAuthorizationClient(properties, registry), Clock.systemUTC(), cache);
    }

    private double count(String result) {
        return registry.get("realtime.authz.cache").tag("result", result).counter().count();
    }

    private String bearer(UUID sid) {
        var claims = new LinkedHashMap<String, Object>();
        claims.put("sub", user.toString());
        claims.put("sid", sid.toString());
        claims.put("gen", 0L);
        claims.put("exp", Date.from(Instant.now().plusSeconds(60)));
        claims.put("type", "access");
        return "Bearer " + Jwts.builder().claims(claims)
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8))).compact();
    }

    @Test
    void secondCallIsServedFromCacheAndOtherSessionOrIslandMisses() {
        var cache = new CurrentMembershipDecisionCache(properties, registry);
        var verifier = verifier(cache);
        UUID sid = UUID.randomUUID();
        verifier.requireMember(island, user, bearer(sid));
        verifier.requireMember(island, user, bearer(sid));
        assertThat(calls.get()).isEqualTo(1);
        assertThat(count("hit")).isEqualTo(1.0);
        assertThat(count("miss")).isEqualTo(1.0);

        verifier.requireMember(island, user, bearer(UUID.randomUUID()));
        verifier.requireMember(UUID.randomUUID(), user, bearer(sid));
        assertThat(calls.get()).isEqualTo(3);
    }

    @Test
    void denyIsNeverCachedSoGrantTakesEffectImmediately() {
        var verifier = verifier(new CurrentMembershipDecisionCache(properties, registry));
        UUID sid = UUID.randomUUID();
        allowed.set(false);
        assertThatThrownBy(() -> verifier.requireMember(island, user, bearer(sid))).isInstanceOf(ChatException.class);
        assertThatThrownBy(() -> verifier.requireMember(island, user, bearer(sid))).isInstanceOf(ChatException.class);
        assertThat(calls.get()).isEqualTo(2);
        allowed.set(true);
        verifier.requireMember(island, user, bearer(sid));
        assertThat(calls.get()).isEqualTo(3);
    }

    @Test
    void evictUserForcesRemoteDecisionSoKickWithdrawAndRevocationRejectImmediately() {
        var cache = new CurrentMembershipDecisionCache(properties, registry);
        var verifier = verifier(cache);
        UUID sid = UUID.randomUUID();
        verifier.requireMember(island, user, bearer(sid));
        allowed.set(false); // 강퇴·탈퇴·세션 폐기 — Data 는 이제 거절한다
        cache.evictUser(user);
        assertThatThrownBy(() -> verifier.requireMember(island, user, bearer(sid))).isInstanceOf(ChatException.class);
        assertThat(calls.get()).isEqualTo(2);
        assertThat(count("evict")).isEqualTo(1.0);
        // 다른 사용자의 evict 는 이 사용자의 항목을 건드리지 않는다
        allowed.set(true);
        verifier.requireMember(island, user, bearer(sid));
        cache.evictUser(UUID.randomUUID());
        verifier.requireMember(island, user, bearer(sid));
        assertThat(calls.get()).isEqualTo(3);
    }

    @Test
    void allowRacingAnEvictIsNotStored() {
        var cache = new CurrentMembershipDecisionCache(properties, registry);
        var identity = jwt.extractSessionProof(bearer(UUID.randomUUID()).substring(7)).orElseThrow();
        long mark = cache.mark();
        cache.evictUser(user); // 조회 도중 사건 도착
        cache.remember(identity, island, mark);
        assertThat(cache.isAllowed(identity, island)).isFalse();
    }

    @Test
    void entryExpiresAfterTtl() throws Exception {
        properties.setCacheTtlSeconds(1);
        var verifier = verifier(new CurrentMembershipDecisionCache(properties, registry));
        UUID sid = UUID.randomUUID();
        verifier.requireMember(island, user, bearer(sid));
        Thread.sleep(1100);
        verifier.requireMember(island, user, bearer(sid));
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void ttlZeroDisablesCache() {
        properties.setCacheTtlSeconds(0);
        var verifier = verifier(new CurrentMembershipDecisionCache(properties, registry));
        UUID sid = UUID.randomUUID();
        verifier.requireMember(island, user, bearer(sid));
        verifier.requireMember(island, user, bearer(sid));
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void cachedAllowStillRequiresValidProof() {
        var verifier = verifier(new CurrentMembershipDecisionCache(properties, registry));
        verifier.requireMember(island, user, bearer(UUID.randomUUID()));
        assertThatThrownBy(() -> verifier.requireMember(island, UUID.randomUUID(), bearer(UUID.randomUUID())))
                .isInstanceOf(UpstreamRejectedCredentialException.class);
    }
}
