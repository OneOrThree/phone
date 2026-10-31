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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.ObjectMapper;

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

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 공개 소식은 검증한 세션 주체로만 읽고 기간 밖 404를 그대로 돌려준다. 목록은 서명 커서로 100건 너머를 잇는다. */
class DeveloperNoticeContractTest extends UpstreamTestBase {
    private static final UUID USER = UUID.fromString("aaaaaaaa-1000-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("aaaaaaaa-1000-0000-0000-000000000002");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1000-0000-0000-000000000001");
    private static final UUID ID = UUID.fromString("cccccccc-1000-0000-0000-000000000001");
    private static final String PUBLIC = "/me/developer-notices";
    private static final String INTERNAL = "GET /internal/users/" + USER + "/developer-notices";
    private static final Instant NEWEST = Instant.parse("2026-10-28T00:00:00.123456Z");

    @Autowired
    SignedCursorCodec codec;
    @Autowired
    CursorConfig.Properties cursorProperties;
    @Autowired
    ObjectMapper mapper;

    @Test
    void listingUsesTheAuthenticatedSubjectAndKeepsNullableExpiry() throws Exception {
        DATA.on(INTERNAL, request -> new MockUpstream.Response(200, "{\"items\":[{\"publicationId\":\"" + ID
                + "\",\"title\":\"소식\",\"body\":\"본문\",\"startsAt\":\"2026-10-29T00:00:00Z\","
                + "\"endsAt\":null,\"publishedAt\":\"2026-10-28T00:00:00Z\"}]}"));
        mockMvc.perform(get("/me/developer-notices")
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION))
                .header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].publicationId").value(ID.toString()))
                .andExpect(jsonPath("$.data.items[0].endsAt").hasJsonPath())
                // hasMore 가 없는 옛 Data 응답도 마지막 쪽이다 — 키는 있고 값만 null.
                .andExpect(jsonPath("$.data.nextCursor").hasJsonPath())
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));
        assertThat(DATA.receivedFor(INTERNAL).get(0).header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(DATA.receivedFor(INTERNAL).get(0).header("Authorization")).isEqualTo("Bearer ci-token-data");
        assertThat(queryParams(DATA.receivedFor(INTERNAL).get(0).query())).containsExactly("limit=100");
    }

    // ---------------------------------------------------------------- 커서

    @Test
    @DisplayName("정확히 100건이고 Data 가 더 없다고 하면 nextCursor 는 null 이다")
    void exactlyOneHundredHasNoCursor() throws Exception {
        DATA.on(INTERNAL, request -> ok(page(0, 100, false)));

        mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(100))
                .andExpect(jsonPath("$.data.nextCursor").hasJsonPath())
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));
    }

    @Test
    @DisplayName("100건 뒤에 더 있으면 마지막 행의 (publishedAt, id) 를 서명 커서에 담고, 다음 요청은 그 경계를 Data 에 되돌린다")
    void fullPageSignsTheLastRowAndReplaysItAsTheAnchor() throws Exception {
        DATA.on(INTERNAL, request -> ok(page(0, 100, true)));

        String next = nextCursor(auth(get(PUBLIC)));
        assertThat(next).doesNotContain(id(99).toString())
                .matches("[a-zA-Z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}");
        assertThat(queryParams(DATA.receivedFor(INTERNAL).get(0).query())).containsExactly("limit=100");

        DATA.on(INTERNAL, request -> ok(page(100, 5, false)));
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", next))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(5))
                .andExpect(jsonPath("$.data.items[0].publicationId").value(id(100).toString()))
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));
        assertThat(queryParams(DATA.receivedFor(INTERNAL).get(1).query())).containsExactlyInAnyOrder(
                "afterPublishedAt=" + published(99), "afterId=" + id(99), "limit=100");
    }

    @Test
    @DisplayName("limit 은 그대로 Data 에 가고 커서는 그 limit 에 묶인다 — 같은 limit 로만 이어진다")
    void explicitLimitIsForwardedAndBoundToTheCursor() throws Exception {
        DATA.on(INTERNAL, request -> ok(page(0, 2, true)));

        String next = nextCursor(auth(get(PUBLIC + "?limit=2")));
        assertThat(queryParams(DATA.receivedFor(INTERNAL).get(0).query())).containsExactly("limit=2");

        DATA.on(INTERNAL, request -> ok(page(2, 1, false)));
        mockMvc.perform(auth(get(PUBLIC + "?limit=2")).queryParam("cursor", next)).andExpect(status().isOk());
        assertThat(queryParams(DATA.receivedFor(INTERNAL).get(1).query())).containsExactlyInAnyOrder(
                "afterPublishedAt=" + published(1), "afterId=" + id(1), "limit=2");
    }

    @Test
    @DisplayName("커서는 사용자·limit·자원에 묶인다 — 다른 사용자·다른 limit·다른 목록의 커서는 상류 호출 없이 400 INVALID_CURSOR")
    void cursorCannotMoveToAnotherScope() throws Exception {
        DATA.on(INTERNAL, request -> ok(page(0, 2, true)));
        String next = nextCursor(auth(get(PUBLIC + "?limit=2")));
        String guestbook = codec.encode(new CursorScope(USER, "islands/guestbook", Map.of("islandId", ID.toString()),
                "created-desc", 2), new CursorBoundary(published(1).toString(), id(1).toString()));
        int before = DATA.received().size();

        mockMvc.perform(get(PUBLIC + "?limit=2").queryParam("cursor", next).header("Authorization",
                        "Bearer " + Tokens.accessWithSession(OTHER, 3, UUID.randomUUID())))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        mockMvc.perform(auth(get(PUBLIC + "?limit=3")).queryParam("cursor", next))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", next))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        mockMvc.perform(auth(get(PUBLIC + "?limit=2")).queryParam("cursor", guestbook))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.received()).hasSize(before);
    }

    @Test
    @DisplayName("빈·위조·중복 커서와 타입이 손상된 서명 경계는 첫 쪽으로 바꾸지 않고 400 INVALID_CURSOR(field=cursor) — Data 호출 0건")
    void forgedCursorsFailBeforeUpstream() throws Exception {
        CursorScope scope = new CursorScope(USER, "me/developer-notices", Map.of(), "published-desc", 100);
        for (String cursor : List.of("", "forged", ID.toString(), "x".repeat(4097),
                codec.encode(scope, new CursorBoundary("not-a-time", ID.toString())),
                codec.encode(scope, new CursorBoundary(NEWEST.toString(), "not-a-uuid")))) {
            mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", cursor))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                    .andExpect(jsonPath("$.error.field").value("cursor"));
        }
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", "a", "b"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("만료된 커서는 상류 호출 없이 409 CURSOR_EXPIRED(field=cursor) 다")
    void expiredCursorFailsBeforeUpstream() throws Exception {
        Map<String, byte[]> keys = cursorProperties.keys().entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> Base64.getDecoder().decode(e.getValue())));
        SignedCursorCodec past = new SignedCursorCodec(keys, cursorProperties.activeKey(),
                Clock.fixed(Instant.parse("2020-01-01T00:00:00Z"), ZoneOffset.UTC), Duration.ofMinutes(15), mapper);
        String cursor = past.encode(new CursorScope(USER, "me/developer-notices", Map.of(), "published-desc", 100),
                new CursorBoundary(NEWEST.toString(), ID.toString()));

        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", cursor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CURSOR_EXPIRED"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "100"})
    @DisplayName("limit 1~100 은 그대로 Data 에 간다")
    void inRangeLimitIsForwarded(String limit) throws Exception {
        DATA.on(INTERNAL, request -> ok("{\"items\":[],\"hasMore\":false}"));

        mockMvc.perform(auth(get(PUBLIC + "?limit=" + limit))).andExpect(status().isOk());
        assertThat(queryParams(DATA.receivedFor(INTERNAL).get(0).query())).containsExactly("limit=" + limit);
    }

    @ParameterizedTest
    @CsvSource({"0,422,OUT_OF_RANGE", "101,422,OUT_OF_RANGE", "-1,422,OUT_OF_RANGE", "abc,400,INVALID_PARAMETER",
            "1.5,400,INVALID_PARAMETER", "'',400,INVALID_PARAMETER"})
    @DisplayName("limit 이 정수가 아니면 400, 1~100 밖이면 422 — Data 를 부르지 않는다")
    void badLimitFailsBeforeUpstream(String limit, int status, String code) throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "?limit=" + limit)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value("limit"));
        mockMvc.perform(auth(get(PUBLIC + "?limit=" + limit)).queryParam("cursor", "forged"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("limit 을 두 번 보내면 Data 를 부르기 전에 400 INVALID_PARAMETER 다")
    void repeatedLimitFailsBeforeUpstream() throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "?limit=1&limit=2")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"3,2,false", "0,2,true", "1,2,true"})
    @DisplayName("Data 쪽 크기가 limit 과 어긋나면(limit 초과 · 더 있다면서 비었거나 limit 미만) 커서를 만들지 않고 계약 위반으로 접는다")
    void upstreamPageSizeContradictionsAreContractErrors(int returned, int limit, boolean hasMore) throws Exception {
        DATA.on(INTERNAL, request -> ok(page(0, returned, hasMore)));

        mockMvc.perform(auth(get(PUBLIC + "?limit=" + limit)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    @DisplayName("공개 문서의 목록 응답은 items·nextCursor 만 싣고 내부 hasMore 는 노출하지 않는다")
    void publicDocumentationListsItemsAndNextCursorOnly() throws Exception {
        String body = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(body).path("components").path("schemas").path("DeveloperNoticePage")
                .path("properties").propertyNames()).containsExactlyInAnyOrder("items", "nextCursor");
    }

    /** 최신순 n번째 소식의 id — 큰 n 이 더 오래된 행이다. */
    private static UUID id(int n) {
        return new UUID(0x0199000010007000L, 0x8000000000000000L | n);
    }

    /** 두 건씩 같은 published_at 을 쓰고, 마이크로초가 남아 경계 왕복에서 값이 깎이면 드러난다. */
    private static Instant published(int n) {
        return NEWEST.minusSeconds(n / 2);
    }

    /** Data 가 보내는 한 쪽 — from 번째부터 count 건. */
    private static String page(int from, int count, boolean hasMore) {
        String items = IntStream.range(from, from + count).mapToObj(n -> "{\"publicationId\":\"" + id(n)
                + "\",\"title\":\"소식 " + n + "\",\"body\":\"본문\",\"startsAt\":\"2026-10-01T00:00:00Z\","
                + "\"endsAt\":null,\"publishedAt\":\"" + published(n) + "\"}").collect(Collectors.joining(","));
        return "{\"items\":[" + items + "],\"hasMore\":" + hasMore + "}";
    }

    private String nextCursor(MockHttpServletRequestBuilder request) throws Exception {
        String body = mockMvc.perform(request).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nextCursor").isString())
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(body).path("data").path("nextCursor").asText();
    }

    private static List<String> queryParams(String query) {
        return query == null ? List.of() : List.of(query.split("&"));
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    @Test
    void missingSessionAndExpiredNoticeAreNotReadable() throws Exception {
        mockMvc.perform(get("/me/developer-notices")).andExpect(status().isUnauthorized());
        assertThat(DATA.receivedFor(INTERNAL)).isEmpty();
        DATA.on(INTERNAL + "/" + ID, request -> new MockUpstream.Response(404,
                "{\"code\":\"NOT_FOUND\",\"message\":\"소식 없음\"}"));
        mockMvc.perform(get("/me/developer-notices/" + ID)
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION)))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }

    @Test
    void detailUsesVerifiedUserAndRejectsMalformedPublicationIdsBeforeUpstream() throws Exception {
        DATA.on(INTERNAL + "/" + ID, request -> new MockUpstream.Response(200,
                "{\"publicationId\":\"" + ID + "\",\"title\":\"소식\",\"body\":\"본문\","
                        + "\"startsAt\":\"2026-10-29T00:00:00Z\",\"endsAt\":null,"
                        + "\"publishedAt\":\"2026-10-28T00:00:00Z\"}"));
        String authorization = "Bearer " + Tokens.accessWithSession(USER, 3, SESSION);
        mockMvc.perform(get("/me/developer-notices/" + ID).header("Authorization", authorization)
                        .header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.publicationId").value(ID.toString()));
        assertThat(DATA.receivedFor(INTERNAL + "/" + ID)).hasSize(1);
        assertThat(DATA.receivedFor(INTERNAL + "/" + ID).get(0).header("X-User-Id")).isEqualTo(USER.toString());
        mockMvc.perform(get("/me/developer-notices/not-a-uuid").header("Authorization", authorization))
                .andExpect(status().isBadRequest());
        assertThat(DATA.receivedFor(INTERNAL + "/not-a-uuid")).isEmpty();
    }

    private static final String REQ = "GET /internal/developer-notices/app-requirements";
    private static final String BODY = "{\"minVersion\":\"2.1.0\",\"title\":\"업데이트\",\"body\":\"본문\","
            + "\"publicationId\":\"" + ID + "\",\"publishedAt\":\"2026-10-28T00:00:00Z\"}";

    @Test
    void appRequirementsIsPublicForAnyTokenAndCachesOnlySuccess() throws Exception {
        DATA.on(REQ, request -> new MockUpstream.Response(200, BODY));
        var tokens = new String[]{null, "Bearer " + Tokens.expired(USER), "Bearer forged.token.value",
                "Bearer " + Tokens.signedWithOtherKey(USER)};
        for (String token : tokens) {
            var builder = get("/auth/sessions/app-requirements?platform=ios");
            if (token != null) {
                builder.header("Authorization", token);
            }
            mockMvc.perform(builder).andExpect(status().isOk())
                    .andExpect(header().stringValues("Cache-Control", "public, max-age=60"))
                    .andExpect(jsonPath("$.data.minVersion").value("2.1.0"))
                    .andExpect(jsonPath("$.data.publicationId").value(ID.toString()))
                    .andExpect(jsonPath("$.data.publishedAt").value("2026-10-28T00:00:00Z"));
        }
        var call = DATA.receivedFor(REQ).get(0);
        assertThat(call.header("X-User-Id")).isNull();
        assertThat(call.header("Authorization")).isEqualTo("Bearer ci-token-data");
    }

    @Test
    void appRequirementsExemptionIsGetOnly() throws Exception {
        for (var builder : new MockHttpServletRequestBuilder[]{
                post("/auth/sessions/app-requirements?platform=ios"),
                delete("/auth/sessions/app-requirements?platform=ios")}) {
            mockMvc.perform(builder).andExpect(status().isUnauthorized());
        }
        assertThat(DATA.receivedFor(REQ)).isEmpty();
    }

    @Test
    void appRequirementsWithoutNoticeKeepsEveryKeyAsNull() throws Exception {
        DATA.on(REQ, request -> new MockUpstream.Response(200, "{\"minVersion\":null,\"title\":null,"
                + "\"body\":null,\"publicationId\":null,\"publishedAt\":null}"));
        mockMvc.perform(get("/auth/sessions/app-requirements?platform=android"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.minVersion").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.data.title").hasJsonPath())
                .andExpect(jsonPath("$.data.publishedAt").hasJsonPath());
    }

    @Test
    void appRequirementsRejectsBadPlatformBeforeUpstreamWithNoStore() throws Exception {
        for (String query : new String[]{"", "?platform=web", "?platform=", "?platform=ios&platform=android",
                "?platform=iOS"}) {
            mockMvc.perform(get("/auth/sessions/app-requirements" + query)).andExpect(status().isBadRequest())
                    .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")));
        }
        assertThat(DATA.receivedFor(REQ)).isEmpty();
    }

    @Test
    void appRequirementsUpstreamFailureIsNotCached() throws Exception {
        DATA.on(REQ, request -> new MockUpstream.Response(500, "{\"code\":\"X\",\"message\":\"boom\"}"));
        mockMvc.perform(get("/auth/sessions/app-requirements?platform=ios"))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isGreaterThanOrEqualTo(400));
    }

    @Test
    void forcesUpdateFollowsTheMinVersionsAndDefaultsToFalseForOldData() throws Exception {
        String common = "\"title\":\"t\",\"body\":\"b\",\"startsAt\":\"2026-10-29T00:00:00Z\","
                + "\"endsAt\":null,\"publishedAt\":\"2026-10-28T00:00:00Z\"";
        DATA.on(INTERNAL, request -> new MockUpstream.Response(200, "{\"items\":["
                + "{\"publicationId\":\"" + ID + "\"," + common + ",\"minAndroidVersion\":\"1.0.0\"},"
                + "{\"publicationId\":\"" + ID + "\"," + common + "},"
                + "{\"publicationId\":\"" + ID + "\"," + common + ",\"minIosVersion\":\"0.0.0\"}]}"));
        mockMvc.perform(get("/me/developer-notices")
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].forcesUpdate").value(true))
                .andExpect(jsonPath("$.data.items[1].forcesUpdate").value(false))
                .andExpect(jsonPath("$.data.items[2].forcesUpdate").value(true))
                .andExpect(jsonPath("$.data.items[0].minAndroidVersion").doesNotExist());
    }
}
