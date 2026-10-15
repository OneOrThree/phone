package com.oneorthree.business.api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/mailbox} 계약 (GROMO-1899) — 섬 문맥 뒤 Realtime 편지방 첫 페이지 · Data 편지함 · 친구를 병렬로
 * 읽고 편지방 작성자 이름을 이어서 붙인다. 인가 거부는 화면 전체 403, 표시 정보 장애는 탈퇴자로 바꾸지 않는다.
 */
class MailboxScreenContractTest extends ScreenContractTestBase {

    private static final UUID OTHER = UUID.fromString("aaaaaaaa-1899-0000-0000-000000000002");
    private static final UUID PEER = UUID.fromString("aaaaaaaa-1899-0000-0000-000000000003");
    private static final UUID M1 = UUID.fromString("01990000-0000-7000-8000-000000001899");
    private static final UUID M2 = UUID.fromString("01990000-0000-7000-8000-000000001900");
    private static final UUID LETTER = UUID.fromString("dddddddd-1899-0000-0000-000000000001");

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_ACCESS = DATA_ISLAND + "/mailbox-access";
    private static final String DATA_AUTHORS = "POST /internal/islands/" + ISLAND + "/message-authors";
    private static final String DATA_LETTERS = "GET " + USERS + "/letters";
    private static final String DATA_FRIENDS = "GET " + USERS + "/friends";
    private static final String RT_HISTORY = "GET /internal/islands/" + ISLAND + "/messages";

    private static final String LETTERS = "{\"content\":[{\"id\":\"" + LETTER + "\",\"counterpartUserId\":\"" + PEER
            + "\",\"counterpartNickname\":\"짝꿍\",\"content\":\"안녕\",\"isRead\":false,"
            + "\"createdAt\":\"2026-09-18T01:00:00Z\"}],\"size\":20,\"hasNext\":false,\"nextCursor\":null}";
    private static final String FRIENDS = "[{\"userId\":\"" + PEER + "\",\"nickname\":\"짝꿍\",\"tierLevel\":3,"
            + "\"occupation\":null,\"isPinned\":false,\"isFocusing\":false,\"focusTimeMinutes\":0,"
            + "\"focusStartedAt\":null,\"focusTagName\":null}]";

    private static String rtMessage(UUID id, UUID sender, String content) {
        return "{\"messageId\":\"" + id + "\",\"groupId\":\"" + ISLAND + "\",\"senderId\":\"" + sender
                + "\",\"content\":\"" + content + "\",\"sentAt\":\"2026-09-18T09:10:00Z\",\"clientMessageId\":\""
                + UUID.randomUUID() + "\"}";
    }

    @BeforeEach
    void stubHappyPath() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":{\"id\":\"" + ISLAND
                + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\",\"approvalRequired\":true,"
                + "\"memberCount\":2,\"maxMembers\":15,\"membershipStatus\":\"active\",\"growthStage\":null,\"themeId\":null,"
                + "\"role\":\"member\",\"version\":3}}"));
        DATA.on(DATA_ACCESS, request -> ok("{\"userId\":\"" + USER + "\",\"name\":\"수빈\"}"));
        DATA.on(DATA_AUTHORS, request -> ok("{\"authors\":[{\"userId\":\"" + USER + "\",\"name\":\"수빈\"},"
                + "{\"userId\":\"" + OTHER + "\",\"name\":\"고양이\"}]}"));
        // 실시간은 최신 → 과거(M2 가 최신). nextCursor = 이 페이지의 가장 오래된 id.
        REALTIME.on(RT_HISTORY, request -> ok("{\"messages\":[" + rtMessage(M2, USER, "두 번째") + ","
                + rtMessage(M1, OTHER, "첫 번째") + "],\"nextCursor\":\"" + M1 + "\",\"hasMore\":true}"));
        DATA.on(DATA_LETTERS, request -> ok(LETTERS));
        DATA.on(DATA_FRIENDS, request -> ok(FRIENDS));
    }

    @Test
    @DisplayName("정상: 편지방(이름·오름차순·서명 커서) · 받은 편지함 · 친구를 한 응답에 담는다")
    void composesMessagesLettersAndFriends() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/mailbox")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.messages.items[0].id").value(M1.toString()))
                .andExpect(jsonPath("$.data.messages.items[0].name").value("고양이"))
                .andExpect(jsonPath("$.data.messages.items[1].id").value(M2.toString()))
                .andExpect(jsonPath("$.data.messages.items[1].name").value("수빈"))
                .andExpect(jsonPath("$.data.messages.items[1].senderId").doesNotExist())
                .andExpect(jsonPath("$.data.messages.nextCursor").isString())
                .andExpect(jsonPath("$.data.letters.content[0].id").value(LETTER.toString()))
                .andExpect(jsonPath("$.data.letters.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.data.friends[0].userId").value(PEER.toString()))
                .andReturn();
        assertKeys(result, "island", "messages", "letters", "friends");
        assertThat(queryParams(REALTIME.receivedFor(RT_HISTORY).get(0).query())).containsExactly("limit=30");
        assertThat(REALTIME.receivedFor(RT_HISTORY).get(0).header("x-user-id")).isEqualTo(USER.toString());
        assertThat(DATA.receivedFor(DATA_LETTERS).get(0).query()).isEqualTo("type=received");
        assertThat(DATA.receivedFor(DATA_AUTHORS)).hasSize(1);
    }

    @Test
    @DisplayName("B10: 편지방 커서는 도메인 GET 이 그대로 이어받는다")
    void messagesCursorContinuesOnDomainGet() throws Exception {
        String body = mockMvc.perform(auth(get("/screens/mailbox"))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String next = body.replaceAll(".*\"nextCursor\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(auth(get("/islands/" + ISLAND + "/messages")).queryParam("cursor", next))
                .andExpect(status().isOk());
        assertThat(queryParams(REALTIME.receivedFor(RT_HISTORY).get(1).query()))
                .containsExactlyInAnyOrder("cursor=" + M1, "limit=30");
    }

    @Test
    @DisplayName("편지방 인가 거부(비주민)는 화면 전체 403 — 실시간 저장소는 부르지 않는다")
    void mailboxAuthorizationDenialFailsWholeScreen() throws Exception {
        DATA.on(DATA_ACCESS, request -> domainError(403, "MEMBER_ONLY"));
        mockMvc.perform(auth(get("/screens/mailbox")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        assertThat(REALTIME.hits(RT_HISTORY)).isZero();
    }

    @Test
    @DisplayName("우체통 미완공은 화면 전체 403 FACILITY_LOCKED")
    void lockedMailboxFailsWholeScreen() throws Exception {
        DATA.on(DATA_ACCESS, request -> domainError(403, "MAILBOX_LOCKED"));
        mockMvc.perform(auth(get("/screens/mailbox")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
        assertThat(REALTIME.hits(RT_HISTORY)).isZero();
    }

    @Test
    @DisplayName("작성자 표시 정보 장애는 화면 실패다 — 이름을 null(탈퇴자)로 채워 200 을 내지 않는다")
    void authorDisplayFailureIsNotRenderedAsWithdrawn() throws Exception {
        DATA.on(DATA_AUTHORS, request -> ok(""));
        mockMvc.perform(auth(get("/screens/mailbox")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));

        DATA.on(DATA_AUTHORS, request -> domainError(404, "USER_NOT_FOUND"));
        mockMvc.perform(auth(get("/screens/mailbox")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));
    }

    @Test
    @DisplayName("빈 편지방은 작성자 조회를 하지 않고 nextCursor:null")
    void emptyRoomSkipsAuthorLookup() throws Exception {
        REALTIME.on(RT_HISTORY, request -> ok("{\"messages\":[],\"nextCursor\":null,\"hasMore\":false}"));
        mockMvc.perform(auth(get("/screens/mailbox")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.messages.items").isEmpty())
                .andExpect(jsonPath("$.data.messages.nextCursor").value(nullValue()));
        assertThat(DATA.hits(DATA_AUTHORS)).isZero();
    }

    @Test
    @DisplayName("현재 섬이 없으면 409 — 임의로 섬을 고르지 않는다(BG01)")
    void noCurrentIslandIsConflict() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));
        mockMvc.perform(auth(get("/screens/mailbox")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.field").value("currentIslandId"));
        assertThat(REALTIME.received()).isEmpty();
    }

    @Test
    void rejectsUnknownQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/mailbox")).queryParam("cursor", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
    }

    /** 쿼리 순서는 계약이 아니다 — 집합으로 본다. */
    private static List<String> queryParams(String query) {
        return query == null ? List.of() : List.of(query.split("&"));
    }
}
