package com.oneorthree.realtime.membership;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.config.ChatOutboundChannelInterceptor;
import com.oneorthree.realtime.config.RealtimeAuthorizationProperties;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.membership.client.RealtimeMembershipAuthorizationClient;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import com.oneorthree.realtime.presence.FocusPresenceReader;
import com.sun.net.httpserver.HttpServer;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 실제 JWT→서비스 HTTP→guard→outbound handler 경로의 현재 인가와 만료 경계를 검증한다. */
class CurrentMembershipVerifierTest {
    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256";
    private final UUID user = UUID.randomUUID();
    private final UUID sid = UUID.randomUUID();
    private final UUID island = UUID.randomUUID();
    private final MutableClock clock = new MutableClock();
    private final Instant expiry = clock.instant().plusSeconds(60);
    private final AtomicInteger calls = new AtomicInteger();
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> response = new AtomicReference<>("{\"allowed\":true}");
    private final AtomicReference<Runnable> beforeResponse = new AtomicReference<>(() -> { });
    private HttpServer server;
    private JwtValidator jwt;
    private CurrentMembershipVerifier verifier;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/realtime/membership-authorization", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            beforeResponse.get().run();
            byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), bytes.length);
            try (var output = exchange.getResponseBody()) {
                output.write(bytes);
            } finally {
                exchange.close();
            }
        });
        server.start();
        RealtimeAuthorizationProperties properties = new RealtimeAuthorizationProperties();
        properties.setEnabled(true);
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setServiceToken("test-current-membership-service");
        properties.setRequestTimeout(Duration.ofSeconds(1));
        jwt = new JwtValidator(SECRET, clock);
        verifier = new CurrentMembershipVerifier(jwt, new RealtimeMembershipAuthorizationClient(properties), clock);
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @ParameterizedTest
    @ValueSource(strings = {"sid", "gen", "exp", "sub", "type"})
    void incompleteProofNeverReachesData(String missing) {
        var claims = claims();
        claims.remove(missing);
        assertThatThrownBy(() -> verifier.requireMember(island, user, "Bearer " + token(claims)))
                .isInstanceOf(UpstreamRejectedCredentialException.class);
        assertThat(calls.get()).isZero();
    }

    @Test
    void subjectMismatchAndExpiredProofNeverReachData() {
        assertThatThrownBy(() -> verifier.requireMember(island, UUID.randomUUID(), "Bearer " + token(claims())))
                .isInstanceOf(UpstreamRejectedCredentialException.class);
        clock.set(expiry.plusSeconds(1));
        assertThatThrownBy(() -> verifier.requireMember(island, user, "Bearer " + token(claims())))
                .isInstanceOf(UpstreamRejectedCredentialException.class);
        assertThat(calls.get()).isZero();
    }

    @Test
    void malformedSignedClaimsAndForeignSignatureNeverReachData() {
        for (Object generation : new Object[]{-1L, 0.0d, "0", 9007199254740992L}) {
            var invalid = claims();
            invalid.put("gen", generation);
            assertThatThrownBy(() -> verifier.requireMember(island, user, "Bearer " + token(invalid)))
                    .isInstanceOf(UpstreamRejectedCredentialException.class);
        }
        for (String field : new String[]{"sub", "sid", "type"}) {
            var invalid = claims();
            invalid.put(field, "1-1-1-1-1");
            assertThatThrownBy(() -> verifier.requireMember(island, user, "Bearer " + token(invalid)))
                    .isInstanceOf(UpstreamRejectedCredentialException.class);
        }
        String foreign = Jwts.builder().claims(claims()).signWith(Keys.hmacShaKeyFor(
                "another-secret-key-that-is-also-long-enough-for-hmac-sha256!!".getBytes(StandardCharsets.UTF_8)))
                .compact();
        assertThatThrownBy(() -> verifier.requireMember(island, user, "Bearer " + foreign))
                .isInstanceOf(UpstreamRejectedCredentialException.class);
        assertThat(calls.get()).isZero();
    }

    @Test
    void expiryDuringDataResponseStillDeniesMembership() {
        beforeResponse.set(() -> clock.set(expiry.plusSeconds(1)));
        assertThatThrownBy(() -> verifier.requireMember(island, user, "Bearer " + token(claims())))
                .isInstanceOf(UpstreamRejectedCredentialException.class);
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void existingSubscribedGroupFrameUsesRealCurrentDecisionOnEveryDelivery() {
        var presence = mock(FocusPresenceReader.class);
        var legacy = mock(MembershipService.class);
        var factory = new DefaultListableBeanFactory();
        factory.registerSingleton("currentMembershipVerifier", verifier);
        var guard = new ChatAccessGuard(presence, legacy, factory.getBeanProvider(CurrentMembershipVerifier.class));
        var sessions = new RealtimeSessionRegistry();
        sessions.register("socket", new ChatPrincipal(user, "Bearer " + token(claims())));
        var interceptor = new ChatOutboundChannelInterceptor(sessions, jwt, guard);
        Message<?> frame = frame("/topic/groups/" + island);

        assertThat(interceptor.beforeHandle(frame, null, null)).isSameAs(frame);
        response.set("{\"allowed\":false}");
        assertThat(interceptor.beforeHandle(frame, null, null)).isNull();
        status.set(500);
        assertThat(interceptor.beforeHandle(frame, null, null)).isNull();

        assertThat(calls.get()).isEqualTo(3);
        verifyNoInteractions(legacy);
        when(presence.isFocusing(user)).thenReturn(true);
        assertThat(interceptor.beforeHandle(frame, null, null)).isNull();
        assertThat(calls.get()).isEqualTo(3);
    }

    @Test
    void legacyOffAndPersonalQueuesDoNotAcquireNewMembershipScope() {
        var presence = mock(FocusPresenceReader.class);
        var legacy = mock(MembershipService.class);
        when(legacy.isMember(island, user, "Bearer legacy")).thenReturn(true);
        new ChatAccessGuard(presence, legacy).requireCanChat(island, user, "Bearer legacy");
        verify(legacy).isMember(island, user, "Bearer legacy");
        var factory = new DefaultListableBeanFactory();
        factory.registerSingleton("currentMembershipVerifier", verifier);
        var guard = new ChatAccessGuard(presence, legacy, factory.getBeanProvider(CurrentMembershipVerifier.class));
        var sessions = new RealtimeSessionRegistry();
        sessions.register("socket", new ChatPrincipal(user, "Bearer " + token(claims())));
        var interceptor = new ChatOutboundChannelInterceptor(sessions, jwt, guard);
        Message<?> duplicate = frame("/queue/duplicates-usersocket");
        assertThat(interceptor.beforeHandle(duplicate, null, null)).isSameAs(duplicate);
        assertThat(interceptor.beforeHandle(frame("/topic/islands/" + island + "/events"), null, null)).isNull();
        assertThat(interceptor.beforeHandle(frame("/queue/events-usersocket"), null, null)).isNull();
        assertThat(calls.get()).isZero();
    }

    private Map<String, Object> claims() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sub", user.toString());
        result.put("sid", sid.toString());
        result.put("gen", 0L);
        result.put("exp", Date.from(expiry));
        result.put("type", "access");
        return result;
    }

    private static String token(Map<String, Object> claims) {
        return Jwts.builder().claims(claims)
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private static Message<?> frame(String destination) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId("socket");
        headers.setDestination(destination);
        return MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders());
    }

    private static final class MutableClock extends Clock {
        private final AtomicReference<Instant> now = new AtomicReference<>(Instant.now());

        void set(Instant value) {
            now.set(value);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now.get();
        }
    }
}
