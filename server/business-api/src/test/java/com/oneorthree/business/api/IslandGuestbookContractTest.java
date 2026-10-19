package com.oneorthree.business.api;

import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.config.CursorConfig;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 방명록 공개 3종 + 인사말 수정의 계약 (GROMO-2262) — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다:
 * 주체·본문 모양(코드포인트 길이)·상류 판정의 공개 오류 매핑. 게시판 완공·섬장·하루 1개의 판정은 data-api 의
 * {@code IslandGuestbookIntegrationTest} 가 실제 DB 로 본다.
 */
class IslandGuestbookContractTest extends UpstreamTestBase {

    @Autowired
    SignedCursorCodec codec;
    @Autowired
    CursorConfig.Properties cursorProperties;
    @Autowired
    ObjectMapper mapper;

    private static final UUID USER = UUID.fromString("aaaaaaaa-2262-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-2262-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-2262-0000-0000-000000000001");
    private static final UUID ENTRY = UUID.fromString("01990000-2262-7000-8000-000000000001");
    private static final String KEY = "eeeeeeee-2262-4000-8000-000000000001";

    private static final String PUBLIC = "/islands/" + ISLAND + "/guestbook";
    private static final String INTERNAL = "/internal/islands/" + ISLAND + "/guestbook";
    private static final String DATA_LIST = "GET " + INTERNAL;
    private static final String DATA_WRITE = "POST " + INTERNAL;
    private static final String DATA_DELETE = "DELETE " + INTERNAL + "/" + ENTRY;
    private static final String DATA_MANAGE = "PATCH /internal/islands/" + ISLAND;

    private static final String ITEM = "{\"id\":\"" + ENTRY + "\",\"authorId\":\"" + USER
            + "\",\"authorName\":\"민지\",\"content\":\"🐟 안녕\",\"createdAt\":\"2026-10-12T05:00:00Z\","
            + "\"mine\":true}";
    private static final String PAGE = "{\"boardBuilt\":true,\"items\":[" + ITEM + ",{\"id\":\"" + UUID.randomUUID()
            + "\",\"authorId\":\"" + UUID.randomUUID() + "\",\"authorName\":null,\"content\":\"hi\","
            + "\"createdAt\":\"2026-10-12T04:00:00Z\",\"mine\":false}],\"hasMore\":false}";

    @Test
    @DisplayName("목록은 상류의 boardBuilt·items 를 그대로 싣고 authorName null 도 키를 유지한다 — 주체는 AT 에서만 간다")
    void listRelaysPage() throws Exception {
        DATA.on(DATA_LIST, request -> ok(PAGE));

        mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.boardBuilt").value(true))
                .andExpect(jsonPath("$.data.items[0].content").value("🐟 안녕"))
                .andExpect(jsonPath("$.data.items[0].mine").value(true))
                .andExpect(jsonPath("$.data.items[1].authorName").hasJsonPath())
                .andExpect(jsonPath("$.data.items[1].authorName").value((Object) null))
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.data.hasMore").doesNotExist());
        assertThat(DATA.receivedFor(DATA_LIST).get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("30개 뒤에는 마지막 글의 시각·id를 서명하고, 다음 요청에서 같은 경계와 고정 크기 30을 Data에 보낸다")
    void listSignsCursorAndForwardsItsBoundary() throws Exception {
        DATA.on(DATA_LIST, request -> ok(pageBody(30, true)));
        String cursor = nextCursor();
        assertThat(decodedQuery(DATA.receivedFor(DATA_LIST).get(0))).containsExactly("limit=30");

        DATA.on(DATA_LIST, request -> ok("{\"boardBuilt\":true,\"items\":[],\"hasMore\":false}"));
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty())
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));
        assertThat(decodedQuery(DATA.receivedFor(DATA_LIST).get(1))).containsExactlyInAnyOrder(
                "afterCreatedAt=2026-10-12T05:00:00.123456Z", "afterId=" + new UUID(0, 30), "limit=30");
    }

    @Test
    @DisplayName("커서는 사용자·섬·자원에 묶인다 — 다른 사용자·섬·공지의 커서는 상류 호출 없이 거절한다")
    void cursorCannotMoveToAnotherScope() throws Exception {
        DATA.on(DATA_LIST, request -> ok(pageBody(30, true)));
        String cursor = nextCursor();
        UUID otherUser = UUID.randomUUID();
        mockMvc.perform(get(PUBLIC).header("Authorization", "Bearer "
                        + Tokens.accessWithSession(otherUser, 3, UUID.randomUUID())).queryParam("cursor", cursor))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        mockMvc.perform(auth(get("/islands/" + UUID.randomUUID() + "/guestbook")).queryParam("cursor", cursor))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        String noticeCursor = codec.encode(new CursorScope(USER, "islands/notices",
                Map.of("islandId", ISLAND.toString()), "created-desc", 30),
                new CursorBoundary("2026-10-12T05:00:00Z", ENTRY.toString()));
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", noticeCursor))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.receivedFor(DATA_LIST)).hasSize(1);
    }

    @Test
    @DisplayName("빈·위조·중복 커서와 타입이 손상된 서명 경계는 첫 페이지로 바꾸지 않고 거절한다")
    void invalidCursorsFailBeforeUpstream() throws Exception {
        for (String cursor : List.of("", "forged", "x".repeat(4097), codec.encode(guestbookScope(),
                new CursorBoundary("not-a-time", ENTRY.toString())), codec.encode(guestbookScope(),
                new CursorBoundary("2026-10-12T05:00:00Z", "not-a-uuid")))) {
            mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", cursor))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                    .andExpect(jsonPath("$.error.field").value("cursor"));
        }
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", "a", "b"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.field").value("cursor"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("만료된 커서는 상류 호출 없이 409 CURSOR_EXPIRED다")
    void expiredCursorFailsBeforeUpstream() throws Exception {
        Map<String, byte[]> keys = cursorProperties.keys().entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> Base64.getDecoder().decode(e.getValue())));
        SignedCursorCodec past = new SignedCursorCodec(keys, cursorProperties.activeKey(),
                Clock.fixed(Instant.parse("2020-01-01T00:00:00Z"), ZoneOffset.UTC), Duration.ofMinutes(15), mapper);
        String cursor = past.encode(guestbookScope(), new CursorBoundary("2019-01-01T00:00:00Z", ENTRY.toString()));
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", cursor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CURSOR_EXPIRED"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"missingPaging", "emptyWithMore", "shortWithMore", "tooMany", "nullItems"})
    @DisplayName("상류 페이지의 누락·모순은 커서 소진으로 숨기지 않고 공개 계약 오류로 드러낸다")
    void invalidUpstreamPagesAreRejected(String shape) throws Exception {
        String body = switch (shape) {
            case "missingPaging" -> "{\"boardBuilt\":true,\"items\":[]}";
            case "emptyWithMore" -> pageBody(0, true);
            case "shortWithMore" -> pageBody(1, true);
            case "tooMany" -> pageBody(31, false);
            default -> "{\"boardBuilt\":true,\"items\":null,\"hasMore\":false}";
        };
        DATA.on(DATA_LIST, request -> ok(body));
        mockMvc.perform(auth(get(PUBLIC))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("공개 문서에는 boardBuilt·items·nextCursor를 싣고 내부 hasMore는 노출하지 않는다")
    void publicDocumentationIncludesCursor() throws Exception {
        String body = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(body).path("components").path("schemas").path("IslandGuestbook")
                .path("properties").propertyNames()).containsExactlyInAnyOrder("boardBuilt", "items", "nextCursor");
    }

    @Test
    @DisplayName("쓰기는 201 로 항목을 돌려주고 명령 키 없이 본문 content 만 상류에 보낸다")
    void writeReturnsCreatedItem() throws Exception {
        DATA.on(DATA_WRITE, request -> ok(ITEM));

        mockMvc.perform(write(post(PUBLIC), "{\"content\":\"  🐟 안녕  \"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(ENTRY.toString()))
                .andExpect(jsonPath("$.data.content").value("🐟 안녕"));
        assertThat(DATA.receivedFor(DATA_WRITE).get(0).body()).contains("\"content\":\"🐟 안녕\"")
                .doesNotContain("userId");
    }

    @ParameterizedTest
    @CsvSource(value = {
            "{}|INVALID_REQUEST|",
            "{\"content\":null}|INVALID_REQUEST|",
            "{\"content\":7}|INVALID_REQUEST|",
            "{\"content\":\"a\",\"userId\":\"x\"}|INVALID_REQUEST|",
            "{\"content\":\"   \"}|INVALID_REQUEST|content",
            "[]|INVALID_REQUEST|"}, delimiter = '|')
    void writeRejectsMalformedBodyBeforeUpstream(String body, String code, String field) throws Exception {
        var result = mockMvc.perform(write(post(PUBLIC), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("길이는 앞뒤 공백을 자른 뒤 코드포인트로 센다 — 이모지 20 개는 공백이 붙어도 통과하고 21 개는 400 이다")
    void contentLimitCountsCodePoints() throws Exception {
        DATA.on(DATA_WRITE, request -> ok(ITEM));

        mockMvc.perform(write(post(PUBLIC), "{\"content\":\"" + "🐟".repeat(20) + "\"}"))
                .andExpect(status().isCreated());
        // 20자에 공백이 붙어도 거절하지 않는다 — 자른 값이 상류로 간다.
        mockMvc.perform(write(post(PUBLIC), "{\"content\":\" " + "🐟".repeat(20) + " \\u3000\"}"))
                .andExpect(status().isCreated());
        assertThat(DATA.receivedFor(DATA_WRITE).get(1).body()).contains("\"content\":\"" + "🐟".repeat(20) + "\"");
        mockMvc.perform(write(post(PUBLIC), "{\"content\":\"" + "🐟".repeat(21) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("content"));
        mockMvc.perform(write(post(PUBLIC), "{\"content\":\" " + "🐟".repeat(21) + " \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("content"));
        assertThat(DATA.receivedFor(DATA_WRITE)).hasSize(2);
    }

    @Test
    @DisplayName("삭제는 200 {deleted:true} 이고 경로 id 가 UUID 가 아니면 상류 전에 400")
    void deleteReturnsDeletedTrue() throws Exception {
        DATA.on(DATA_DELETE, request -> ok("{\"deleted\":true}"));

        mockMvc.perform(auth(delete(PUBLIC + "/" + ENTRY)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));
        mockMvc.perform(auth(delete(PUBLIC + "/not-a-uuid"))).andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @CsvSource({
            "403,BOARD_LOCKED,403,FACILITY_LOCKED,",
            "403,SOCIAL_LOGIN_REQUIRED,403,SOCIAL_LOGIN_REQUIRED,",
            "409,GUESTBOOK_ALREADY_WRITTEN_TODAY,409,GUESTBOOK_ALREADY_WRITTEN_TODAY,",
            "400,BANNED_WORD,400,BANNED_WORD,",
            // 한 줄 규칙(줄바꿈·제어문자)은 Data 의 NAME_PATTERN 하나가 판정한다 — 본문 파서 거절 400 을 그대로 옮긴다.
            "400,INVALID_REQUEST,400,INVALID_REQUEST,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,BOARD_LOCKED,400,UPSTREAM_CONTRACT_ERROR,"})
    void writeRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_WRITE, request -> error(upstreamStatus, upstreamCode));
        var result = mockMvc.perform(write(post(PUBLIC), "{\"content\":\"안녕\"}"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    @ParameterizedTest
    @CsvSource({
            "403,NOT_OWNER,403,FORBIDDEN,",
            "404,NOT_FOUND,404,NOT_FOUND,entryId"})
    void deleteRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_DELETE, request -> error(upstreamStatus, upstreamCode));
        var result = mockMvc.perform(auth(delete(PUBLIC + "/" + ENTRY)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    @Test
    @DisplayName("읽기는 게시판 잠김을 오류로 만들지 않는다 — 상류가 boardBuilt=false 로 답한다")
    void listRelaysBoardNotBuilt() throws Exception {
        DATA.on(DATA_LIST, request -> ok("{\"boardBuilt\":false,\"items\":[],\"hasMore\":false}"));

        mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.boardBuilt").value(false))
                .andExpect(jsonPath("$.data.items").isEmpty())
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));
    }

    // ---------------------------------------------------------------- 인사말 수정 (PATCH /islands/{id})

    @Test
    @DisplayName("인사말은 PATCH 허용 키다 — 앞뒤 공백을 자른 뒤 이모지 40 개는 상류로 가고 41 개는 상류 전에 400 INVALID_REQUEST")
    void greetingIsAllowedKeyWithCodePointLimit() throws Exception {
        DATA.on(DATA_MANAGE, request -> ok("{\"id\":\"" + ISLAND + "\",\"name\":\"모래\",\"intro\":\"\","
                + "\"approvalRequired\":false,\"maxMembers\":15,\"version\":2}"));

        mockMvc.perform(write(patch("/islands/" + ISLAND), "{\"greeting\":\"" + "🐟".repeat(40) + "\"}"))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_MANAGE).get(0).body()).contains("\"greeting\":\"" + "🐟".repeat(40) + "\"");

        // 40자에 공백이 붙어도 거절하지 않는다 — Data 가 공백을 잘라 저장하므로 길이는 자른 뒤로 센다.
        mockMvc.perform(write(patch("/islands/" + ISLAND), "{\"greeting\":\"  " + "🐟".repeat(40) + " \\u3000\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(write(patch("/islands/" + ISLAND), "{\"greeting\":\"" + "🐟".repeat(41) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("greeting"));
        mockMvc.perform(write(patch("/islands/" + ISLAND), "{\"greeting\":\" " + "🐟".repeat(41) + " \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("greeting"));
        mockMvc.perform(write(patch("/islands/" + ISLAND), "{\"greeting\":null}"))
                .andExpect(status().isBadRequest());
        assertThat(DATA.receivedFor(DATA_MANAGE)).hasSize(2);
    }

    @ParameterizedTest
    @CsvSource({
            "403,NOT_OWNER,403,FORBIDDEN",
            "403,SOCIAL_LOGIN_REQUIRED,403,SOCIAL_LOGIN_REQUIRED",
            "400,BANNED_WORD,400,BANNED_WORD",
            // 한 줄 규칙(줄바꿈·제어문자)은 Data 의 NAME_PATTERN 하나가 판정한다 — 본문 파서 거절 400 을 그대로 옮긴다.
            "400,INVALID_REQUEST,400,INVALID_REQUEST"})
    void greetingEditRelaysOwnerGuestBannedWordAndShapeVerdicts(int upstreamStatus, String upstreamCode, int status,
            String code) throws Exception {
        DATA.on(DATA_MANAGE, request -> error(upstreamStatus, upstreamCode));
        mockMvc.perform(write(patch("/islands/" + ISLAND), "{\"greeting\":\"안녕\"}"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
    }

    // ---------------------------------------------------------------- 도구

    private String nextCursor() throws Exception {
        String body = mockMvc.perform(auth(get(PUBLIC))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nextCursor").isString())
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(body).path("data").path("nextCursor").asText();
    }

    private static CursorScope guestbookScope() {
        return new CursorScope(USER, "islands/guestbook", Map.of("islandId", ISLAND.toString()), "created-desc", 30);
    }

    private static String pageBody(int size, boolean more) {
        String items = IntStream.range(0, size).mapToObj(i -> ITEM.replace(ENTRY.toString(), new UUID(0, i + 1).toString())
                .replace("2026-10-12T05:00:00Z", "2026-10-12T05:00:00.123456Z")).collect(Collectors.joining(","));
        return "{\"boardBuilt\":true,\"items\":[" + items + "],\"hasMore\":" + more + "}";
    }

    private static List<String> decodedQuery(MockUpstream.RecordedRequest request) {
        return java.util.Arrays.stream(request.query().split("&"))
                .map(value -> java.net.URLDecoder.decode(value, java.nio.charset.StandardCharsets.UTF_8)).toList();
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
