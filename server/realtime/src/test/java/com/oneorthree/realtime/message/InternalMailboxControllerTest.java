package com.oneorthree.realtime.message;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.dto.MailboxStoreResult;
import com.oneorthree.realtime.message.dto.SendMessageRequest;
import com.oneorthree.realtime.message.repository.ChatMessageRepository;
import com.oneorthree.realtime.message.service.ChatMessageService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 우체통 내부 어댑터 (GROMO-1775) — 서비스 토큰 관문부터 저장소의 유니크 제약까지 «실제 배선»으로 본다.
 *
 * <p>legacy {@code ChatControllerTest} 와 같은 이유로 {@code @AutoConfigureMockMvc} 다: 검증 대상의 절반이
 * 컨트롤러 밖({@code InternalServiceTokenFilter} 의 URL 패턴, {@code @LoginUser} 배선, 오류 봉투)에 있다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class InternalMailboxControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private ChatMessageRepository chatMessageRepository;

    @Autowired
    private ChatMessageService chatMessageService;

    @Value("${realtime.internal.service-token}")
    private String serviceToken;

    /** legacy 경로의 멤버십 상류 — 이 테스트는 내부 경로만 부르므로 호출되지 않는다. */
    @MockitoBean
    private GroupClient groupClient;

    private UUID userId;
    private UUID island;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        island = UUID.randomUUID();
    }

    @AfterEach
    void tearDown() {
        redis.delete(RedisKeys.focusPresence(userId));
    }

    @Test
    @DisplayName("서비스 토큰이 없거나 틀리면 401 — 봉투는 JwtFilter 와 같은 {code, message} 다")
    void rejectsMissingOrWrongServiceToken() throws Exception {
        mockMvc.perform(get(path()).header("X-User-Id", userId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(get(path()).header(HttpHeaders.AUTHORIZATION, "Bearer wrong").header("X-User-Id", userId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("주체(X-User-Id)가 없거나 UUID 가 아니면 400 — 배선 사고를 500 으로 흘리지 않는다")
    void rejectsMissingSubject() throws Exception {
        mockMvc.perform(get(path()).header(HttpHeaders.AUTHORIZATION, "Bearer " + serviceToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mockMvc.perform(get(path()).header(HttpHeaders.AUTHORIZATION, "Bearer " + serviceToken)
                        .header("X-User-Id", "not-a-uuid"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("앱 AT 로는 내부 경로에 들어올 수 없다 — 서비스 토큰 축과 사용자 축이 섞이지 않는다")
    void appTokenIsNotAServiceToken() throws Exception {
        mockMvc.perform(get(path()).header(HttpHeaders.AUTHORIZATION, "Bearer " + serviceToken + "x")
                        .header("X-User-Id", userId))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("저장 → 201 · freshlyInserted=true, 히스토리에 그 메시지가 나온다. 이름 없이 senderId 만 실린다")
    void storesAndLists() throws Exception {
        UUID key = UUID.randomUUID();
        mockMvc.perform(store(key, "오늘도 같이 집중하자"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.freshlyInserted").value(true))
                .andExpect(jsonPath("$.message.senderId").value(userId.toString()))
                .andExpect(jsonPath("$.message.groupId").value(island.toString()))
                .andExpect(jsonPath("$.message.clientMessageId").value(key.toString()))
                .andExpect(jsonPath("$.message.content").value("오늘도 같이 집중하자"))
                .andExpect(jsonPath("$.message.name").doesNotExist());

        mockMvc.perform(history(null, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].clientMessageId").value(key.toString()))
                .andExpect(jsonPath("$.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.hasMore").value(false));
    }

    @Test
    @DisplayName("같은 키·같은 본문 재전송은 같은 201 로 «처음 저장된 그 메시지»를 돌려주고 행은 하나다")
    void replaysOriginalOnSameKeySameText() throws Exception {
        UUID key = UUID.randomUUID();
        String first = mockMvc.perform(store(key, "안녕")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(store(key, "  안녕  "))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.freshlyInserted").value(false))
                .andExpect(jsonPath("$.message.messageId").value(messageIdOf(first)));

        assertThat(chatMessageRepository.findByGroupIdAndSenderIdAndClientMessageId(island, userId, key)).isPresent();
        assertThat(chatMessageRepository.findByGroupIdOrderByIdDesc(island,
                org.springframework.data.domain.PageRequest.of(0, 10))).hasSize(1);
    }

    @Test
    @DisplayName("같은 키·다른 본문은 409 IDEMPOTENCY_KEY_REUSED — legacy 와 달리 원문을 되돌리지 않는다(M05)")
    void rejectsSameKeyDifferentText() throws Exception {
        UUID key = UUID.randomUUID();
        mockMvc.perform(store(key, "첫 번째 말")).andExpect(status().isCreated());
        mockMvc.perform(store(key, "두 번째 말"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
    }

    @Test
    @DisplayName("집중 중이어도 우체통은 열려 있다 — 서버는 집중·휴식으로 막지 않는다(M12, MQ02 결정)")
    void mailboxIgnoresFocusPresence() throws Exception {
        redis.opsForValue().set(RedisKeys.focusPresence(userId), "1", Duration.ofMinutes(5));

        mockMvc.perform(store(UUID.randomUUID(), "집중 중에도 보낸다")).andExpect(status().isCreated());
        mockMvc.perform(history(null, null)).andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1));
    }

    @Test
    @DisplayName("빈 본문·NUL 은 저장 전에 거절한다 — 400 이지 500 이 아니다")
    void rejectsBlankAndNul() throws Exception {
        mockMvc.perform(store(UUID.randomUUID(), "   ")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BLANK_CONTENT"));
        mockMvc.perform(store(UUID.randomUUID(), "a\u0000b")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CONTENT"));
    }

    @Test
    @DisplayName("페이징 — limit+1 로 «더 있는가»를 판정하고 nextCursor 는 이 페이지의 가장 오래된 id 다")
    void pagesFromNewestToOldest() throws Exception {
        UUID k1 = UUID.randomUUID();
        UUID k2 = UUID.randomUUID();
        UUID k3 = UUID.randomUUID();
        mockMvc.perform(store(k1, "1")).andExpect(status().isCreated());
        mockMvc.perform(store(k2, "2")).andExpect(status().isCreated());
        mockMvc.perform(store(k3, "3")).andExpect(status().isCreated());

        MvcResult page1 = mockMvc.perform(history(null, 2)).andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(2))
                .andExpect(jsonPath("$.messages[0].clientMessageId").value(k3.toString()))
                .andExpect(jsonPath("$.messages[1].clientMessageId").value(k2.toString()))
                .andExpect(jsonPath("$.hasMore").value(true))
                .andReturn();
        String nextCursor = page1.getResponse().getContentAsString()
                .replaceAll(".*\"nextCursor\":\"([0-9a-f-]{36})\".*", "$1");

        mockMvc.perform(history(nextCursor, 2)).andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].clientMessageId").value(k1.toString()))
                .andExpect(jsonPath("$.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.hasMore").value(false));
    }

    /**
     * 경쟁 — 같은 키의 두 저장이 <b>동시에</b> 들어온다. 판정은 애플리케이션 검사가 아니라 DB 유니크 제약
     * {@code ux_chat_messages_dedup} 이다: 둘 중 하나만 INSERT 에 성공하고, 다른 하나는 위반을 잡아 «그 행»을
     * 돌려준다. 그래서 두 응답의 messageId 가 같고, freshlyInserted 는 정확히 하나만 true 이며, 행은 하나다.
     */
    @Test
    @DisplayName("동시 재전송 둘 — 행 하나, 같은 messageId, freshlyInserted 는 정확히 하나")
    void concurrentSameKeyStoresExactlyOnce() throws Exception {
        UUID key = UUID.randomUUID();
        SendMessageRequest request = new SendMessageRequest("동시에", key);
        int racers = 2;
        CountDownLatch ready = new CountDownLatch(racers);
        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(racers);
        try {
            List<Future<MailboxStoreResult>> futures = new ArrayList<>();
            for (int i = 0; i < racers; i++) {
                Callable<MailboxStoreResult> racer = () -> {
                    ready.countDown();
                    go.await(5, TimeUnit.SECONDS);
                    return chatMessageService.storeFromMailbox(island, userId, request);
                };
                futures.add(pool.submit(racer));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            go.countDown();

            List<MailboxStoreResult> results = new ArrayList<>();
            for (Future<MailboxStoreResult> future : futures) {
                results.add(future.get(10, TimeUnit.SECONDS));
            }
            assertThat(results).extracting(r -> r.message().messageId()).containsOnly(results.get(0).message().messageId());
            assertThat(results).filteredOn(MailboxStoreResult::freshlyInserted).hasSize(1);
            assertThat(chatMessageRepository.findByGroupIdOrderByIdDesc(island,
                    org.springframework.data.domain.PageRequest.of(0, 10))).hasSize(1);
        } finally {
            pool.shutdownNow();
        }
    }

    private String path() {
        return "/internal/islands/" + island + "/messages";
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder history(String cursor,
            Integer limit) {
        var builder = get(path()).header(HttpHeaders.AUTHORIZATION, "Bearer " + serviceToken)
                .header("X-User-Id", userId);
        if (cursor != null) {
            builder.queryParam("cursor", cursor);
        }
        if (limit != null) {
            builder.queryParam("limit", limit.toString());
        }
        return builder;
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder store(UUID key, String text) {
        return post(path()).header(HttpHeaders.AUTHORIZATION, "Bearer " + serviceToken)
                .header("X-User-Id", userId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":" + json(text) + ",\"clientMessageId\":\"" + key + "\"}");
    }

    private static String json(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\u0000", "\\u0000") + "\"";
    }

    private static String messageIdOf(String body) {
        return body.replaceAll(".*\"messageId\":\"([0-9a-f-]{36})\".*", "$1");
    }
}
