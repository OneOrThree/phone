package com.oneorthree.realtime.message;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.repository.ChatReadCursorRepository;
import com.oneorthree.realtime.message.service.ChatUserFence;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Data 의 {@code user.withdrawn} 수신 (GROMO-1943 · 계정 LLD §4 chat_read_cursors) — Data 전용 토큰 관문부터
 * 커서 파기·tombstone·이후 쓰기 거절까지 «실제 배선»과 실제 PostgreSQL 로 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class InternalEventControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ChatReadCursorRepository chatReadCursorRepository;

    @Autowired
    private ChatUserFence chatUserFence;

    @Value("${realtime.internal.data-service-token}")
    private String dataToken;

    @Value("${realtime.internal.service-token}")
    private String businessToken;

    /** legacy 경로의 멤버십 상류 — 이 테스트는 호출하지 않는다. */
    @MockitoBean
    private GroupClient groupClient;

    private UUID withdrawn;
    private UUID other;

    @BeforeEach
    void setUp() {
        withdrawn = UUID.randomUUID();
        other = UUID.randomUUID();
    }

    @Test
    @DisplayName("Data 토큰만 통한다 — Business 토큰·무토큰은 401, Data 토큰은 Business 내부 경로를 못 연다")
    void onlyTheDataTokenOpensTheEventRoute() throws Exception {
        mockMvc.perform(event(withdrawn, 1).header(HttpHeaders.AUTHORIZATION, "Bearer " + businessToken))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(body(withdrawn, 1)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/internal/islands/" + UUID.randomUUID() + "/messages")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken).header("X-User-Id", other))
                .andExpect(status().isUnauthorized());
        assertThat(tombstones(withdrawn)).isZero();
    }

    @Test
    @DisplayName("탈퇴 → 그 사용자 커서 0행 · tombstone 1행, 재전달해도 같고, 이후 커서 UPSERT 는 행을 만들지 못한다")
    void withdrawalErasesCursorsAndFencesLaterWrites() throws Exception {
        UUID roomA = UUID.randomUUID();
        UUID roomB = UUID.randomUUID();
        upsert(roomA, withdrawn);
        upsert(roomB, withdrawn);
        upsert(roomA, other);
        assertThat(cursors(withdrawn)).isEqualTo(2);

        mockMvc.perform(authorized(event(withdrawn, 1))).andExpect(status().isOk())
                .andExpect(jsonPath("$.accepted").value(true));

        assertThat(cursors(withdrawn)).isZero();
        assertThat(tombstones(withdrawn)).isEqualTo(1);
        assertThat(cursors(other)).isEqualTo(1);

        // 같은 사건의 재전달 · 역순으로 온 낮은 세대 — 결과가 1회 때와 같고 세대는 되돌아가지 않는다.
        mockMvc.perform(authorized(event(withdrawn, 1))).andExpect(status().isOk());
        mockMvc.perform(authorized(event(withdrawn, 0))).andExpect(status().isOk());
        assertThat(cursors(withdrawn)).isZero();
        assertThat(tombstones(withdrawn)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT auth_generation FROM user_tombstones WHERE user_id = ?",
                Long.class, withdrawn)).isEqualTo(1L);

        // 멤버십 캐시가 통과시킨 늦은 읽음 요청 — 관문에서 거절되고, 저장소를 직접 불러도 행이 생기지 않는다.
        assertThatThrownBy(() -> chatUserFence.writeReadCursor(roomA, withdrawn, UUID.randomUUID()))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode()).isEqualTo(ChatErrorCode.NOT_A_MEMBER);
        assertThat(upsert(roomA, withdrawn)).isZero();
        assertThat(cursors(withdrawn)).isZero();
    }

    @Test
    @DisplayName("다른 사건 종류·형식 오류는 400 — tombstone 을 만들지 않는다")
    void rejectsOtherEventTypesAndMalformedBodies() throws Exception {
        mockMvc.perform(authorized(post("/internal/events").contentType(MediaType.APPLICATION_JSON)
                        .content(body(withdrawn, 1).replace("user.withdrawn", "user.updated"))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(authorized(post("/internal/events").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"user.withdrawn\",\"userId\":\"" + withdrawn + "\",\"params\":{}}")))
                .andExpect(status().isBadRequest());
        assertThat(tombstones(withdrawn)).isZero();
    }

    private int upsert(UUID room, UUID user) {
        return chatReadCursorRepository.upsertIfNewer(UUID.randomUUID(), room, user, UUID.randomUUID(), Instant.now());
    }

    private long cursors(UUID user) {
        return jdbc.queryForObject("SELECT count(*) FROM chat_read_cursors WHERE user_id = ?", Long.class, user);
    }

    private long tombstones(UUID user) {
        return jdbc.queryForObject("SELECT count(*) FROM user_tombstones WHERE user_id = ?", Long.class, user);
    }

    private MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder request) {
        return request.header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken);
    }

    private static MockHttpServletRequestBuilder event(UUID user, long generation) {
        return post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(body(user, generation));
    }

    /** Data outbox 의 정본 봉투 모양 그대로 — 이 소비자가 읽지 않는 필드도 싣는다. */
    private static String body(UUID user, long generation) {
        return "{\"eventId\":\"user.withdrawn:" + user + "\",\"schemaVersion\":1,\"type\":\"user.withdrawn\","
                + "\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":\"" + user + "\",\"version\":7,"
                + "\"params\":{\"userId\":\"" + user + "\",\"authGeneration\":" + generation + "}}";
    }
}
