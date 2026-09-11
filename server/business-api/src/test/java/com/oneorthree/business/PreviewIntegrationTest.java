package com.oneorthree.business;

import com.oneorthree.business.linkpreview.client.PreviewResolver;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.support.PreviewContent;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"jwt.secret=" + PreviewIntegrationTest.SECRET, "management.server.port=0"})
@AutoConfigureMockMvc
@Testcontainers
class PreviewIntegrationTest {
    static final String SECRET = "business-test-secret-at-least-32-bytes-long";
    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);
    @DynamicPropertySource
    static void redis(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired StringRedisTemplate redis;
    @MockitoBean PreviewResolver resolver;
    String user;
    String token;

    @BeforeEach
    void setup() {
        user = UUID.randomUUID().toString();
        token = token(user, "access", Instant.now().plusSeconds(60));
    }

    static String token(String subject, String type, Instant expires) {
        var builder = Jwts.builder().subject(subject).claim("type", type)
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)));
        if (expires != null) builder.expiration(Date.from(expires));
        return "Bearer " + builder.compact();
    }

    String submit(String url) throws Exception {
        return mapper.readTree(mvc.perform(post("/api/v1/link-previews").header("Authorization", token)
                .contentType("application/json").content(mapper.writeValueAsString(Map.of("urls", List.of(url)))))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-Id")).andReturn().getResponse().getContentAsString())
                .get(0).path("id").asText();
    }

    @Test
    void deduplicatesPendingAndIsolatesThumbnailsByUser() throws Exception {
        var gate = new CountDownLatch(1);
        when(resolver.resolve(any())).thenAnswer(call -> {
            assertThat(gate.await(5, TimeUnit.SECONDS)).isTrue();
            return new PreviewContent("사진", "image/png", 100L, "FILE", "AQID");
        });
        String id;
        try {
            id = submit("https://example.com/a.png");
            assertThat(submit("https://example.com/a.png")).isEqualTo(id);
            mvc.perform(get("/api/v1/link-previews/" + id).header("Authorization", token))
                    .andExpect(jsonPath("$.status").value("PENDING"));
        } finally {
            gate.countDown();
        }
        await().atMost(5, TimeUnit.SECONDS).untilAsserted(() ->
                mvc.perform(get("/api/v1/link-previews/" + id).header("Authorization", token))
                        .andExpect(jsonPath("$.status").value("READY")));
        verify(resolver, times(1)).resolve(URI.create("https://example.com/a.png"));
        mvc.perform(get("/api/v1/link-previews/" + id + "/thumbnail").header("Authorization", token))
                .andExpect(status().isOk()).andExpect(content().bytes(new byte[]{1, 2, 3}))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get("/api/v1/link-previews/" + id + "/thumbnail").header("Authorization",
                token(UUID.randomUUID().toString(), "access", Instant.now().plusSeconds(60))))
                .andExpect(status().isNotFound());
        assertThat(redis.getExpire("cache:business:preview:" + user + ":" + id)).isBetween(290L, 300L);
    }

    @Test
    void failureIsCachedBrieflyAndExpiryAllowsRetry() throws Exception {
        when(resolver.resolve(any())).thenThrow(new PreviewException("NOT_PUBLIC_OR_NOT_FOUND"));
        String url = "https://drive.google.com/file/d/test/view";
        String id = submit(url);
        await().atMost(5, TimeUnit.SECONDS).untilAsserted(() ->
                mvc.perform(get("/api/v1/link-previews/" + id).header("Authorization", token))
                        .andExpect(jsonPath("$.status").value("FAILED"))
                        .andExpect(jsonPath("$.errorCode").value("NOT_PUBLIC_OR_NOT_FOUND")));
        submit(url);
        verify(resolver, times(1)).resolve(any());
        assertThat(redis.getExpire("cache:business:preview:" + user + ":" + id)).isBetween(20L, 30L);
        redis.delete("cache:business:preview:" + user + ":" + id);
        doReturn(new PreviewContent("공개됨", "application/pdf", null, "FILE", null)).when(resolver).resolve(any());
        submit(url);
        await().atMost(5, TimeUnit.SECONDS).untilAsserted(() -> verify(resolver, times(2)).resolve(any()));
    }

    @Test
    void rejectsMissingExpiredRefreshAndNoExpiryTokens() throws Exception {
        mvc.perform(post("/api/v1/link-previews")).andExpect(status().isUnauthorized());
        for (String invalid : List.of(token(user, "refresh", Instant.now().plusSeconds(60)),
                token(user, "access", Instant.now().minusSeconds(60)), token(user, "access", null),
                "Bearer invalid", token("not-a-uuid", "access", Instant.now().plusSeconds(60)))) {
            mvc.perform(get("/api/v1/link-previews/abc").header("Authorization", invalid))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        }
    }

    @Test
    void rejectsOversizeBatchBodyAndLimitsRequests() throws Exception {
        mvc.perform(post("/api/v1/link-previews").header("Authorization", token)
                .contentType("application/json").content("{\"urls\":[]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/link-previews").header("Authorization", token)
                .contentType("application/json").content("x".repeat(50_000)))
                .andExpect(status().isPayloadTooLarge());
        redis.opsForValue().set("cache:business:rate:" + user, "240");
        mvc.perform(get("/api/v1/link-previews/abc").header("Authorization", token))
                .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "60"));
    }
}
