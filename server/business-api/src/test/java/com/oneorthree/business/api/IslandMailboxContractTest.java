package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 우체통 편지방 공개 표면 (GROMO-1775) — 무접두 경로가 Business 에 있고, Data(인가·표시·outbox)와 실시간(저장소)으로
 * 나뉘어 나간다는 것을 실제 필터·컨트롤러·HTTP 로 확인한다.
 */
class IslandMailboxContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000075");
    private static final UUID OTHER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000076");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000075");
    private static final UUID ISLAND = UUID.fromString("cccccccc-0000-0000-0000-000000000075");
    private static final UUID M1 = UUID.fromString("01990000-0000-7000-8000-000000000001");
    private static final UUID M2 = UUID.fromString("01990000-0000-7000-8000-000000000002");
    private static final UUID KEY = UUID.fromString("dddddddd-0000-4000-8000-000000000075");
    private static final String PUBLIC = "/islands/" + ISLAND + "/messages";
    private static final String DATA_ACCESS = "GET /internal/islands/" + ISLAND + "/mailbox-access";
    private static final String DATA_AUTHORS = "POST /internal/islands/" + ISLAND + "/message-authors";
    private static final String DATA_EVENTS = "POST /internal/islands/" + ISLAND + "/message-events";
    private static final String RT_MESSAGES = "/internal/islands/" + ISLAND + "/messages";
    private static final String RT_HISTORY = "GET " + RT_MESSAGES;
    private static final String RT_STORE = "POST " + RT_MESSAGES;

    private static String rtMessage(UUID id, UUID sender, String content, UUID key) {
        return "{\"messageId\":\"" + id + "\",\"groupId\":\"" + ISLAND + "\",\"senderId\":\"" + sender
                + "\",\"content\":\"" + content + "\",\"sentAt\":\"2026-09-18T09:10:00Z\",\"clientMessageId\":\""
                + key + "\"}";
    }

    private void stubHappyPath() {
        DATA.on(DATA_ACCESS, request -> ok("{\"userId\":\"" + USER + "\",\"name\":\"수빈\"}"));
        DATA.on(DATA_AUTHORS, request -> ok("{\"authors\":[{\"userId\":\"" + USER + "\",\"name\":\"수빈\"},"
                + "{\"userId\":\"" + OTHER + "\",\"name\":null}]}"));
        // 실시간은 최신 → 과거로 준다(M2 가 최신). nextCursor = 이 페이지의 가장 오래된 id.
        REALTIME.on(RT_HISTORY, request -> ok("{\"messages\":[" + rtMessage(M2, USER, "두 번째", KEY) + ","
                + rtMessage(M1, OTHER, "첫 번째", UUID.randomUUID()) + "],\"nextCursor\":\"" + M1 + "\",\"hasMore\":true}"));
        REALTIME.on(RT_STORE, request -> new MockUpstream.Response(201,
                "{\"message\":" + rtMessage(M2, USER, "오늘도 같이 집중하자", KEY) + ",\"freshlyInserted\":true}"));
        DATA.on(DATA_EVENTS, request -> ok("{\"eventId\":\"message.created:" + M2 + "\",\"version\":1}"));
    }

    @Test
    void listComposesAscendingItemsWithNamesAndSignedCursor() throws Exception {
        stubHappyPath();
        MvcResult first = mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().isOk())
                // 한 묶음 안에서는 오름차순 — 오래된 M1 이 먼저(M06)
                .andExpect(jsonPath("$.data.items[0].id").value(M1.toString()))
                .andExpect(jsonPath("$.data.items[0].userId").value(OTHER.toString()))
                .andExpect(jsonPath("$.data.items[0].name").value(nullValue()))
                .andExpect(jsonPath("$.data.items[0].text").value("첫 번째"))
                .andExpect(jsonPath("$.data.items[1].id").value(M2.toString()))
                .andExpect(jsonPath("$.data.items[1].name").value("수빈"))
                .andExpect(jsonPath("$.data.items[1].clientMessageId").value(KEY.toString()))
                .andExpect(jsonPath("$.data.items[1].createdAt").value("2026-09-18T09:10:00Z"))
                .andExpect(jsonPath("$.data.items[1].catColor").doesNotExist())
                .andExpect(jsonPath("$.data.items[1].senderId").doesNotExist())
                .andExpect(jsonPath("$.data.nextCursor").isString())
                .andReturn();
        // 실시간 커서(UUID)를 그대로 노출하지 않는다 — 서명 커서(keyId.body.sig)다.
        String next = first.getResponse().getContentAsString().replaceAll(".*\"nextCursor\":\"([^\"]+)\".*", "$1");
        assertThat(next).doesNotContain(M1.toString()).matches("[a-zA-Z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}");

        var history = REALTIME.receivedFor(RT_HISTORY).get(0);
        assertThat(history.header("x-user-id")).isEqualTo(USER.toString());
        assertThat(history.header("authorization")).isEqualTo("Bearer ci-token-realtime");
        assertThat(queryParams(history.query())).containsExactlyInAnyOrder("limit=30");
        assertThat(DATA.receivedFor(DATA_AUTHORS).get(0).body()).contains(USER.toString(), OTHER.toString());
        assertThat(DATA.receivedFor(DATA_ACCESS).get(0).header("authorization")).isEqualTo("Bearer ci-token-data");

        // 다음 페이지 — 서명 커서를 풀어 실시간에는 anchor(id)로 넘긴다.
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", next)).andExpect(status().isOk());
        // 쿼리 순서는 계약이 아니다 — InternalCall 이 Map.copyOf 로 담아 순서가 실행마다 다르다. 집합으로 본다.
        assertThat(queryParams(REALTIME.receivedFor(RT_HISTORY).get(1).query()))
                .containsExactlyInAnyOrder("cursor=" + M1, "limit=30");
    }

    @Test
    void listReturnsNullCursorOnLastPage() throws Exception {
        stubHappyPath();
        REALTIME.on(RT_HISTORY, request -> ok("{\"messages\":[],\"nextCursor\":null,\"hasMore\":false}"));
        mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty())
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));
        assertThat(DATA.hits(DATA_AUTHORS)).isZero();
    }

    @Test
    void listRejectsForgedCursorBeforeAnyUpstreamCall() throws Exception {
        stubHappyPath();
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", M1.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        assertThat(DATA.received()).isEmpty();
        assertThat(REALTIME.received()).isEmpty();
    }

    /** 서명 커서는 사용자·섬·limit 에 결박된다 — 다른 limit 으로 재사용하면 400 이다(LLD §5). */
    @Test
    void listRejectsCursorReusedWithDifferentLimit() throws Exception {
        stubHappyPath();
        String next = mockMvc.perform(auth(get(PUBLIC)).queryParam("limit", "2")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString().replaceAll(".*\"nextCursor\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", next).queryParam("limit", "3"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "101", "abc", "1.5", "-1", ""})
    void listRejectsBadLimit(String limit) throws Exception {
        stubHappyPath();
        mockMvc.perform(auth(get(PUBLIC)).queryParam("limit", limit))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(REALTIME.received()).isEmpty();
    }

    @Test
    void listRejectsRepeatedQueryParameter() throws Exception {
        stubHappyPath();
        mockMvc.perform(auth(get(PUBLIC)).queryParam("limit", "10").queryParam("limit", "20"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("limit"));
    }

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,islandId", "403,MAILBOX_LOCKED,403,FACILITY_LOCKED,",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,"})
    void listRelaysResidencyAndFacilityVerdicts(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        stubHappyPath();
        DATA.on(DATA_ACCESS, request -> error(upstreamStatus, upstreamCode));
        var result = mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(REALTIME.received()).isEmpty();
    }

    /** 표시 상류 장애를 「전원 탈퇴」로 그리지 않는다 — 503 으로 드러낸다(LLD §2). */
    @Test
    void listFailsClosedWhenAuthorProjectionIsUnavailable() throws Exception {
        stubHappyPath();
        DATA.on(DATA_AUTHORS, request -> error(503, "SERVICE_UNAVAILABLE"));
        mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    void sendAuthorizesThenStoresThenAppendsOutboxOnce() throws Exception {
        stubHappyPath();
        mockMvc.perform(write(post(PUBLIC), body(KEY.toString(), "  오늘도 같이 집중하자 ")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(M2.toString()))
                .andExpect(jsonPath("$.data.clientMessageId").value(KEY.toString()))
                .andExpect(jsonPath("$.data.userId").value(USER.toString()))
                .andExpect(jsonPath("$.data.name").value("수빈"))
                .andExpect(jsonPath("$.data.text").value("오늘도 같이 집중하자"))
                .andExpect(jsonPath("$.data.createdAt").value("2026-09-18T09:10:00Z"))
                .andExpect(jsonPath("$.data.catColor").doesNotExist());

        assertThat(DATA.hits(DATA_ACCESS)).isEqualTo(1);
        var stored = REALTIME.receivedFor(RT_STORE).get(0);
        assertThat(stored.header("x-user-id")).isEqualTo(USER.toString());
        assertThat(stored.header("authorization")).isEqualTo("Bearer ci-token-realtime");
        assertThat(stored.body()).contains(KEY.toString(), "오늘도 같이 집중하자");
        var event = DATA.receivedFor(DATA_EVENTS).get(0);
        assertThat(event.header("x-user-id")).isEqualTo(USER.toString());
        // 사건 본문에 메시지 text 가 없다(M02) — 식별자·시각뿐.
        assertThat(event.body()).contains(M2.toString(), KEY.toString(), "2026-09-18T09:10:00Z")
                .doesNotContain("오늘도", "\"text\"");
        assertThat(DATA.hits(DATA_EVENTS)).isEqualTo(1);
    }

    /** 재전송(이미 있던 행)은 같은 201 이지만 사건은 다시 적지 않는다. */
    @Test
    void sendReplayDoesNotAppendOutboxAgain() throws Exception {
        stubHappyPath();
        REALTIME.on(RT_STORE, request -> new MockUpstream.Response(201,
                "{\"message\":" + rtMessage(M2, USER, "오늘도 같이 집중하자", KEY) + ",\"freshlyInserted\":false}"));
        mockMvc.perform(write(post(PUBLIC), body(KEY.toString(), "오늘도 같이 집중하자")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(M2.toString()));
        assertThat(DATA.hits(DATA_EVENTS)).isZero();
    }

    /** 저장 뒤 적재 실패 — 요청은 201, 사건만 유실(문서화된 동작). 앱은 history 로 복구한다. */
    @Test
    void sendSucceedsWhenOutboxAppendFailsAfterStore() throws Exception {
        stubHappyPath();
        DATA.on(DATA_EVENTS, request -> error(503, "SERVICE_UNAVAILABLE"));
        mockMvc.perform(write(post(PUBLIC), body(KEY.toString(), "오늘도 같이 집중하자")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(M2.toString()));
        assertThat(DATA.hits(DATA_EVENTS)).isGreaterThanOrEqualTo(1);
    }

    @Test
    void sendRelaysKeyReuseWithBodyField() throws Exception {
        stubHappyPath();
        REALTIME.on(RT_STORE, request -> error(409, "IDEMPOTENCY_KEY_REUSED"));
        mockMvc.perform(write(post(PUBLIC), body(KEY.toString(), "다른 말")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("IDEMPOTENCY_KEY_REUSED"))
                .andExpect(jsonPath("$.error.field").value("clientMessageId"))
                .andExpect(jsonPath("$.error.retryable").value(false));
        assertThat(DATA.hits(DATA_EVENTS)).isZero();
    }

    @Test
    void sendRejectsNonResidentBeforeStoring() throws Exception {
        stubHappyPath();
        DATA.on(DATA_ACCESS, request -> error(403, "MEMBER_ONLY"));
        mockMvc.perform(write(post(PUBLIC), body(KEY.toString(), "안녕")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        assertThat(REALTIME.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource(value = {
            "{\"text\":\"안녕\"}|INVALID_REQUEST|",
            "{\"clientMessageId\":\"dddddddd-0000-4000-8000-000000000075\"}|INVALID_REQUEST|",
            "{\"clientMessageId\":\"dddddddd-0000-4000-8000-000000000075\",\"text\":\"안녕\",\"senderId\":\"x\"}|INVALID_REQUEST|",
            "{\"clientMessageId\":null,\"text\":\"안녕\"}|INVALID_REQUEST|clientMessageId",
            "{\"clientMessageId\":\"dddddddd-0000-4000-8000-000000000075\",\"text\":12}|INVALID_REQUEST|text",
            "{\"clientMessageId\":\"local-1\",\"text\":\"안녕\"}|INVALID_IDEMPOTENCY_KEY|clientMessageId",
            "{\"clientMessageId\":\"dddddddd-0000-4000-8000-000000000075\",\"text\":\"   \"}|OUT_OF_RANGE|text",
            "{\"clientMessageId\":\"dddddddd-0000-4000-8000-000000000075\",\"text\":\"a\\u0000b\"}|OUT_OF_RANGE|text",
            "[]|INVALID_REQUEST|"}, delimiter = '|')
    void sendRejectsMalformedBodyBeforeAnyUpstreamCall(String body, String code, String field) throws Exception {
        stubHappyPath();
        var result = mockMvc.perform(write(post(PUBLIC), body))
                .andExpect(status().is(code.equals("OUT_OF_RANGE") ? 422 : 400))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.received()).isEmpty();
        assertThat(REALTIME.received()).isEmpty();
    }

    @Test
    void sendRejectsTextOver2000Utf16Units() throws Exception {
        stubHappyPath();
        mockMvc.perform(write(post(PUBLIC), body(KEY.toString(), "가".repeat(2001))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("text"));
        mockMvc.perform(write(post(PUBLIC), body(KEY.toString(), "가".repeat(2000)))).andExpect(status().isCreated());
    }

    @Test
    void requiresAccessToken() throws Exception {
        mockMvc.perform(get(PUBLIC)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        mockMvc.perform(post(PUBLIC).contentType(MediaType.APPLICATION_JSON).content(body(KEY.toString(), "안녕")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsNonCanonicalIslandId() throws Exception {
        mockMvc.perform(auth(get("/islands/not-a-uuid/messages")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("islandId"));
    }

    private static java.util.List<String> queryParams(String query) {
        return query == null ? java.util.List.of() : java.util.List.of(query.split("&"));
    }

    private static String body(String key, String text) {
        return "{\"clientMessageId\":\"" + key + "\",\"text\":\"" + text + "\"}";
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
