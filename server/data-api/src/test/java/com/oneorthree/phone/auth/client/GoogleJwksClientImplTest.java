package com.oneorthree.phone.auth.client;

import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.sun.net.httpserver.HttpServer;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * GROMO-966 — Google ID 토큰 {@code aud} 허용 목록 검증. 로컬 JWKS 서버와 실제 RSA 서명 토큰으로
 * 서명·aud·iss 검증 경로 전체를 확인한다.
 */
class GoogleJwksClientImplTest {

    private static final String KID = "test-kid";
    private static final String ISS = "https://accounts.google.com";
    private static final String IOS_CLIENT = "ios-client.apps.googleusercontent.com";
    private static final String WEB_CLIENT = "web-client.apps.googleusercontent.com";

    private static HttpServer server;
    private static KeyPair keyPair;
    private static String jwksUrl;

    @BeforeAll
    static void startJwks() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        keyPair = generator.generateKeyPair();
        RSAPublicKey publicKey = (RSAPublicKey) keyPair.getPublic();
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String body = "{\"keys\":[{\"kid\":\"" + KID + "\",\"kty\":\"RSA\",\"alg\":\"RS256\",\"n\":\""
                + encoder.encodeToString(unsigned(publicKey.getModulus().toByteArray())) + "\",\"e\":\""
                + encoder.encodeToString(unsigned(publicKey.getPublicExponent().toByteArray())) + "\"}]}";
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
        jwksUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/";
    }

    @AfterAll
    static void stopJwks() {
        if (server != null) {
            server.stop(0);
        }
    }

    private static byte[] unsigned(byte[] value) {
        if (value.length > 1 && value[0] == 0) {
            byte[] trimmed = new byte[value.length - 1];
            System.arraycopy(value, 1, trimmed, 0, trimmed.length);
            return trimmed;
        }
        return value;
    }

    private static String token(String audience, String issuer) {
        return token(new String[] {audience}, issuer);
    }

    private static String token(String[] audiences, String issuer) {
        return Jwts.builder()
                .header().keyId(KID).and()
                .subject("google-sub-1")
                .audience().add(Arrays.asList(audiences)).and()
                .issuer(issuer)
                .expiration(Date.from(Instant.now().plusSeconds(300)))
                .signWith(keyPair.getPrivate())
                .compact();
    }

    @Test
    @DisplayName("허용 목록의 iOS·웹 클라이언트 aud 토큰은 모두 통과한다")
    void allowsEveryListedAudience() {
        GoogleJwksClientImpl client = new GoogleJwksClientImpl(jwksUrl, IOS_CLIENT + ", " + WEB_CLIENT);

        assertThat(client.getProviderId(token(IOS_CLIENT, ISS))).isEqualTo("google-sub-1");
        assertThat(client.getProviderId(token(WEB_CLIENT, ISS))).isEqualTo("google-sub-1");
    }

    @Test
    @DisplayName("aud 가 여러 개면 목록 밖 값이 섞여 있어도 목록 안 값이 하나라도 있으면 통과한다")
    void allowsWhenAnyAudienceListed() {
        GoogleJwksClientImpl client = new GoogleJwksClientImpl(jwksUrl, IOS_CLIENT);

        assertThat(client.getProviderId(token(new String[] {"other-app", IOS_CLIENT}, ISS))).isEqualTo("google-sub-1");
        assertThatThrownBy(() -> client.getProviderId(token(new String[] {"other-app", WEB_CLIENT}, ISS)))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("단일 값 설정도 그대로 동작한다 — 기존 배포 설정 호환")
    void singleValueStillWorks() {
        GoogleJwksClientImpl client = new GoogleJwksClientImpl(jwksUrl, IOS_CLIENT);

        assertThat(client.getProviderId(token(IOS_CLIENT, ISS))).isEqualTo("google-sub-1");
        assertThatThrownBy(() -> client.getProviderId(token(WEB_CLIENT, ISS)))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("허용 목록 밖 aud 의 정상 서명 토큰은 GOOGLE_TOKEN 으로 거절한다")
    void rejectsUnlistedAudience() {
        GoogleJwksClientImpl client = new GoogleJwksClientImpl(jwksUrl, IOS_CLIENT + "," + WEB_CLIENT);

        assertThatThrownBy(() -> client.getProviderId(token("other-app.apps.googleusercontent.com", ISS)))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("설정이 비었거나 공백뿐이면 모든 토큰을 거절한다")
    void rejectsWhenAllowlistEmpty() {
        for (String raw : new String[] {"", " ", " , ", null}) {
            GoogleJwksClientImpl client = new GoogleJwksClientImpl(jwksUrl, raw);
            assertThatThrownBy(() -> client.getProviderId(token(IOS_CLIENT, ISS)))
                    .isInstanceOf(InvalidTokenException.class);
        }
    }

    @Test
    @DisplayName("aud 가 맞아도 iss 가 Google 이 아니면 거절한다")
    void rejectsWrongIssuer() {
        GoogleJwksClientImpl client = new GoogleJwksClientImpl(jwksUrl, IOS_CLIENT);

        assertThatThrownBy(() -> client.getProviderId(token(IOS_CLIENT, "https://evil.example.com")))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("허용 목록 파싱은 앞뒤 공백과 빈 항목을 버린다")
    void parsesAllowlist() {
        assertThat(GoogleJwksClientImpl.parseAllowedAudiences(" a , ,b,")).containsExactlyInAnyOrder("a", "b");
        assertThat(GoogleJwksClientImpl.parseAllowedAudiences(null)).isEmpty();
    }
}
