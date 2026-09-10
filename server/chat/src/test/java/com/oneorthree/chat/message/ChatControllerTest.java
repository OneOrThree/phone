package com.oneorthree.chat.message;

import com.oneorthree.chat.TestcontainersConfiguration;
import com.oneorthree.chat.common.redis.RedisKeys;
import com.oneorthree.chat.membership.client.GroupClient;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Set;
import java.util.UUID;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * REST 표면 — 인증 필터부터 에러 봉투까지 «실제 필터 체인»을 통과시켜 본다.
 *
 * <p>{@code standaloneSetup} 이 아니라 {@code @AutoConfigureMockMvc} 로 «실제 필터 체인»을 조립하는
 * 이유: 이 테스트가 확인하려는 것의 절반이 컨트롤러 밖에 있기 때문이다({@code JwtFilter} 의 등록 URL
 * 패턴, {@code @LoginUser} 리졸버 배선, {@code GlobalExceptionHandler} 의 봉투). standalone 은 그 셋을
 * 전부 건너뛰고, 직접 조립한 MockMvc 는 {@code FilterRegistrationBean} 으로 등록된 필터를 태우지
 * 않는다 — 그러면 인증이 통째로 빠진 채 «전부 500» 이 된다(실제로 그렇게 한 번 깨졌다).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class ChatControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StringRedisTemplate redis;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @MockitoBean
    private GroupClient groupClient;

    private UUID userId;
    private UUID island;
    private String bearer;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        island = UUID.randomUUID();
        bearer = bearerOf(userId);
        redis.delete(RedisKeys.memberCache(userId));
        redis.delete(RedisKeys.focusPresence(userId));
        given(groupClient.fetchMyGroupIds(bearer)).willReturn(Set.of(island));
    }

    @AfterEach
    void tearDown() {
        redis.delete(RedisKeys.memberCache(userId));
        redis.delete(RedisKeys.focusPresence(userId));
    }

    @Test
    @DisplayName("토큰 없이 부르면 401 이고, 봉투는 STOMP 와 같은 {code, message} 다")
    void rejectsAnonymous() throws Exception {
        mockMvc.perform(get("/api/v1/chat/rooms"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.message").exists());
    }

    @Test
    @DisplayName("내 섬은 메시지가 하나도 없어도 목록에 나온다 — 모수는 «속한 섬»이지 «대화가 있는 섬»이 아니다")
    void listsIslandsWithoutMessages() throws Exception {
        mockMvc.perform(get("/api/v1/chat/rooms").header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].groupId").value(island.toString()))
                .andExpect(jsonPath("$[0].lastMessage").doesNotExist())
                .andExpect(jsonPath("$[0].unreadCount").value(0));
    }

    @Test
    @DisplayName("집중 중이면 방 목록조차 409 다 — 배지만 보여도 그게 유혹이 된다")
    void blocksRoomListWhileFocusing() throws Exception {
        redis.opsForValue().set(RedisKeys.focusPresence(userId), "1", Duration.ofMinutes(5));

        mockMvc.perform(get("/api/v1/chat/rooms").header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("FOCUS_IN_PROGRESS"));
    }

    @Test
    @DisplayName("남의 섬 히스토리는 403 NOT_A_MEMBER — 없는 섬도 같은 답이라 존재 여부가 새지 않는다")
    void hidesOtherIslandHistory() throws Exception {
        mockMvc.perform(get("/api/v1/chat/rooms/" + UUID.randomUUID() + "/messages")
                        .header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_A_MEMBER"));
    }

    @Test
    @DisplayName("깨진 커서는 «처음부터»로 접지 않고 400 이다 — 조용히 접으면 무한 스크롤이 영원히 돈다")
    void rejectsBrokenCursor() throws Exception {
        mockMvc.perform(get("/api/v1/chat/rooms/" + island + "/messages")
                        .param("cursor", "not-a-uuid")
                        .header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CURSOR"));
    }

    @Test
    @DisplayName("빈 방의 히스토리는 빈 목록 + 커서 없음이다")
    void emptyHistory() throws Exception {
        mockMvc.perform(get("/api/v1/chat/rooms/" + island + "/messages")
                        .header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages").isEmpty())
                .andExpect(jsonPath("$.hasMore").value(false))
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    @DisplayName("읽음 표시는 204 이고, 같은 위치를 다시 보내도 여전히 204 다(커서가 안 움직였을 뿐)")
    void markReadIsIdempotent() throws Exception {
        String body = "{\"lastReadMessageId\":\"" + UUID.randomUUID() + "\"}";

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/v1/chat/rooms/" + island + "/read")
                            .header(HttpHeaders.AUTHORIZATION, bearer)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isNoContent());
        }
    }

    @Test
    @DisplayName("읽음 위치가 없으면 400 — 검증 실패도 같은 봉투로 나간다")
    void rejectsMissingReadCursor() throws Exception {
        mockMvc.perform(post("/api/v1/chat/rooms/" + island + "/read")
                        .header(HttpHeaders.AUTHORIZATION, bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    private String bearerOf(UUID id) {
        return "Bearer " + Jwts.builder()
                .subject(id.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
    }
}
