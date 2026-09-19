package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 게시판 공개 6종의 계약 (GROMO-1771) — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다: 주체·본문 모양·
 * 서명 커서(목록 {@code cursor} / 댓글 {@code commentsCursor})·상류 판정의 공개 오류 매핑. 권한·version·멱등의
 * 원자성은 data-api 의 {@code IslandNoticeIntegrationTest} 가 실제 DB 로 본다.
 */
class IslandNoticeContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1771-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("aaaaaaaa-1771-0000-0000-000000000002");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1771-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1771-0000-0000-000000000001");
    private static final UUID N1 = UUID.fromString("01990000-1771-7000-8000-000000000001");
    private static final UUID N2 = UUID.fromString("01990000-1771-7000-8000-000000000002");
    private static final UUID C1 = UUID.fromString("01990000-1771-7000-8000-0000000000c1");
    private static final UUID C2 = UUID.fromString("01990000-1771-7000-8000-0000000000c2");
    private static final String KEY = "eeeeeeee-1771-4000-8000-000000000001";

    private static final String PUBLIC = "/islands/" + ISLAND + "/notices";
    private static final String INTERNAL = "/internal/islands/" + ISLAND + "/notices";
    private static final String DATA_LIST = "GET " + INTERNAL;
    private static final String DATA_CREATE = "POST " + INTERNAL;
    private static final String DATA_DETAIL = "GET " + INTERNAL + "/" + N1;
    private static final String DATA_PATCH = "PATCH " + INTERNAL + "/" + N1;
    private static final String DATA_DELETE = "DELETE " + INTERNAL + "/" + N1;
    private static final String DATA_COMMENT = "POST " + INTERNAL + "/" + N1 + "/comments";

    private static final String PAGE_BODY = "{\"items\":[{\"id\":\"" + N2 + "\",\"title\":\"둘째\",\"commentCount\":0,"
            + "\"createdAt\":\"2026-09-19T01:00:00Z\"},{\"id\":\"" + N1 + "\",\"title\":\"환영해요\","
            + "\"commentCount\":1,\"createdAt\":\"2026-09-19T00:00:00.123456Z\"}],\"hasMore\":true}";
    private static final String DETAIL_BODY = "{\"id\":\"" + N1 + "\",\"title\":\"환영해요\",\"body\":\"같이 집중해요\","
            + "\"version\":3,\"comments\":[{\"id\":\"" + C1 + "\",\"userId\":\"" + USER + "\",\"name\":\"민지\","
            + "\"text\":\"좋아요\",\"createdAt\":\"2026-09-19T00:10:00Z\"},{\"id\":\"" + C2 + "\",\"userId\":null,"
            + "\"name\":null,\"text\":\"떠난 주민\",\"createdAt\":\"2026-09-19T00:10:00Z\"}],\"hasMoreComments\":true}";
    private static final String NOTICE_BODY = "{\"id\":\"" + N1 + "\",\"title\":\"공지 제목\",\"body\":\"내용\"}";

    // ---------------------------------------------------------------- 조회 · 커서

    @Test
    @DisplayName("목록은 원본 필드만 싣고, 다음 쪽은 마지막 행의 (createdAt, id) 를 서명 커서에 담아 Data 에 되돌린다")
    void listSignsKeysetCursorAndReplaysItAsAnchor() throws Exception {
        DATA.on(DATA_LIST, request -> ok(PAGE_BODY));

        String next = mockMvc.perform(auth(get(PUBLIC)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].id").value(N2.toString()))
                .andExpect(jsonPath("$.data.items[1].title").value("환영해요"))
                .andExpect(jsonPath("$.data.items[1].commentCount").value(1))
                .andExpect(jsonPath("$.data.items[1].createdAt").doesNotExist())
                .andExpect(jsonPath("$.data.nextCursor").isString())
                .andReturn().getResponse().getContentAsString()
                .replaceAll(".*\"nextCursor\":\"([^\"]+)\".*", "$1");
        assertThat(next).doesNotContain(N1.toString()).matches("[a-zA-Z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}");

        MockUpstream.RecordedRequest first = DATA.receivedFor(DATA_LIST).get(0);
        assertThat(first.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(queryParams(first.query())).containsExactly("limit=30");

        DATA.on(DATA_LIST, request -> ok("{\"items\":[],\"hasMore\":false}"));
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", next))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty())
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));
        assertThat(queryParams(DATA.receivedFor(DATA_LIST).get(1).query())).containsExactlyInAnyOrder(
                "afterCreatedAt=2026-09-19T00:00:00.123456Z", "afterId=" + N1, "limit=30");
    }

    @Test
    @DisplayName("위조 목록 커서는 상류를 부르기 전에 400 INVALID_CURSOR(field=cursor)")
    void forgedListCursorIsRejectedBeforeUpstream() throws Exception {
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", N1.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        mockMvc.perform(auth(get(PUBLIC)).queryParam("cursor", "a").queryParam("cursor", "b"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("cursor"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("상세는 댓글 페이지를 조합하고 탈퇴 작성자는 userId·name 을 null 로 싣는다 — catColor 는 없다")
    void detailComposesCommentsPage() throws Exception {
        DATA.on(DATA_DETAIL, request -> ok(DETAIL_BODY));

        mockMvc.perform(auth(get(PUBLIC + "/" + N1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(N1.toString()))
                .andExpect(jsonPath("$.data.body").value("같이 집중해요"))
                .andExpect(jsonPath("$.data.version").value(3))
                .andExpect(jsonPath("$.data.comments[0].name").value("민지"))
                .andExpect(jsonPath("$.data.comments[0].createdAt").value("2026-09-19T00:10:00Z"))
                .andExpect(jsonPath("$.data.comments[0].catColor").doesNotExist())
                .andExpect(jsonPath("$.data.comments[1].userId").value(nullValue()))
                .andExpect(jsonPath("$.data.comments[1].name").value(nullValue()))
                .andExpect(jsonPath("$.data.nextCommentsCursor").isString());
        assertThat(queryParams(DATA.receivedFor(DATA_DETAIL).get(0).query())).containsExactly("commentsLimit=30");
    }

    @Test
    @DisplayName("댓글 커서의 오류 field 는 commentsCursor 다 — 위조·다른 공지로 옮긴 커서·목록 커서 모두")
    void commentsCursorErrorsNameTheSubmittedField() throws Exception {
        DATA.on(DATA_DETAIL, request -> ok(DETAIL_BODY));
        String next = mockMvc.perform(auth(get(PUBLIC + "/" + N1))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()
                .replaceAll(".*\"nextCommentsCursor\":\"([^\"]+)\".*", "$1");

        // 같은 공지 — Data 에 댓글 anchor 로 넘어간다(동률 시각이라 id 가 경계를 가른다).
        mockMvc.perform(auth(get(PUBLIC + "/" + N1)).queryParam("commentsCursor", next))
                .andExpect(status().isOk());
        assertThat(queryParams(DATA.receivedFor(DATA_DETAIL).get(1).query())).containsExactlyInAnyOrder(
                "commentsAfterCreatedAt=2026-09-19T00:10:00Z", "commentsAfterId=" + C2, "commentsLimit=30");

        int before = DATA.received().size();
        // 다른 공지로 옮긴 커서
        mockMvc.perform(auth(get(PUBLIC + "/" + N2)).queryParam("commentsCursor", next))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.error.field").value("commentsCursor"));
        // 위조
        mockMvc.perform(auth(get(PUBLIC + "/" + N1)).queryParam("commentsCursor", "forged"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("commentsCursor"));
        // 목록 커서를 댓글 자리에 — scope 가 달라 거절된다.
        DATA.on(DATA_LIST, request -> ok(PAGE_BODY));
        String listCursor = mockMvc.perform(auth(get(PUBLIC))).andReturn().getResponse().getContentAsString()
                .replaceAll(".*\"nextCursor\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(auth(get(PUBLIC + "/" + N1)).queryParam("commentsCursor", listCursor))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("commentsCursor"));
        assertThat(DATA.receivedFor(DATA_DETAIL)).hasSize(2);
        assertThat(DATA.received()).hasSize(before + 1);
    }

    // ---------------------------------------------------------------- 쓰기

    @Test
    @DisplayName("작성은 201 이고 서명 주체·앱 키·두 필드만 Data 로 간다 — 공격자 X-User-Id 는 버려진다")
    void createForwardsSignedSubjectKeyAndBody() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(NOTICE_BODY));

        mockMvc.perform(write(post(PUBLIC), "{\"title\":\"공지 제목\",\"body\":\"내용\"}").header("X-User-Id", OTHER))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(N1.toString()))
                .andExpect(jsonPath("$.data.title").value("공지 제목"))
                .andExpect(jsonPath("$.data.body").value("내용"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_CREATE).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.body()).isEqualTo("{\"title\":\"공지 제목\",\"body\":\"내용\"}");
    }

    @Test
    @DisplayName("PATCH 는 보낸 필드만 넘긴다 — 생략은 유지, 명시 null·빈 본문·미지 필드는 거절")
    void patchForwardsOnlyPresentFields() throws Exception {
        DATA.on(DATA_PATCH, request -> ok(NOTICE_BODY));

        mockMvc.perform(write(patch(PUBLIC + "/" + N1), "{\"title\":\"수정 제목\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.body").value("내용"));
        assertThat(DATA.receivedFor(DATA_PATCH).get(0).body()).isEqualTo("{\"title\":\"수정 제목\"}");

        mockMvc.perform(write(patch(PUBLIC + "/" + N1), "{\"title\":\"a\",\"body\":\"b\"}"))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_PATCH).get(1).body()).isEqualTo("{\"title\":\"a\",\"body\":\"b\"}");
        assertThat(DATA.hits(DATA_PATCH)).isEqualTo(2);
    }

    @ParameterizedTest
    @CsvSource(value = {
            "{}|400|INVALID_REQUEST|",
            "{\"title\":null}|400|INVALID_REQUEST|title",
            "{\"body\":7}|400|INVALID_REQUEST|body",
            "{\"title\":\"a\",\"expectedVersion\":1}|400|INVALID_REQUEST|",
            "{\"title\":\"   \"}|422|OUT_OF_RANGE|title",
            "{\"body\":\"\"}|422|OUT_OF_RANGE|body",
            "[]|400|INVALID_REQUEST|"}, delimiter = '|')
    void patchRejectsMalformedBodyBeforeUpstream(String body, int status, String code, String field) throws Exception {
        var result = mockMvc.perform(write(patch(PUBLIC + "/" + N1), body))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource(value = {
            "{\"title\":\"제목\"}|400|INVALID_REQUEST|",
            "{\"title\":\"제목\",\"body\":\"본문\",\"userId\":\"x\"}|400|INVALID_REQUEST|",
            "{\"title\":null,\"body\":\"본문\"}|400|INVALID_REQUEST|title",
            "{\"title\":\" \",\"body\":\"본문\"}|422|OUT_OF_RANGE|title",
            "{\"title\":\"제목\",\"body\":\"  \"}|422|OUT_OF_RANGE|body",
            "{\"title\":\"제목\",\"body\":\"a\\u0000b\"}|422|OUT_OF_RANGE|body"}, delimiter = '|')
    void createRejectsMalformedBodyBeforeUpstream(String body, int status, String code, String field)
            throws Exception {
        var result = mockMvc.perform(write(post(PUBLIC), body))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("제목은 100 UTF-16 단위까지 — 101 은 422")
    void titleLimitIsOneHundredUtf16Units() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(NOTICE_BODY));
        mockMvc.perform(write(post(PUBLIC), "{\"title\":\"" + "가".repeat(101) + "\",\"body\":\"본문\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("title"));
        mockMvc.perform(write(post(PUBLIC), "{\"title\":\"" + "가".repeat(100) + "\",\"body\":\"본문\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("삭제는 200 deleted=true, 댓글은 201 — 둘 다 앱 키가 필수다")
    void deleteAndCommentShapes() throws Exception {
        DATA.on(DATA_DELETE, request -> ok("{\"deleted\":true}"));
        DATA.on(DATA_COMMENT, request -> ok("{\"id\":\"" + C1 + "\",\"name\":\"수빈\",\"text\":\"좋아요\"}"));

        mockMvc.perform(auth(delete(PUBLIC + "/" + N1)).header("Idempotency-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));
        assertThat(DATA.receivedFor(DATA_DELETE).get(0).header("Idempotency-Key")).isEqualTo(KEY);

        mockMvc.perform(write(post(PUBLIC + "/" + N1 + "/comments"), "{\"text\":\"좋아요\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(C1.toString()))
                .andExpect(jsonPath("$.data.name").value("수빈"))
                .andExpect(jsonPath("$.data.text").value("좋아요"));
        assertThat(DATA.receivedFor(DATA_COMMENT).get(0).body()).isEqualTo("{\"text\":\"좋아요\"}");

        // 대리 작성자·키 없음은 상류 전에 거절된다.
        mockMvc.perform(write(post(PUBLIC + "/" + N1 + "/comments"), "{\"text\":\"a\",\"userId\":\"" + OTHER + "\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(auth(delete(PUBLIC + "/" + N1)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(auth(post(PUBLIC + "/" + N1 + "/comments"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"a\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        assertThat(DATA.hits(DATA_DELETE)).isEqualTo(1);
        assertThat(DATA.hits(DATA_COMMENT)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 상류 판정 → 공개 오류

    @ParameterizedTest
    @CsvSource({
            "403,MEMBER_ONLY,403,FORBIDDEN,",
            "403,NOTICE_FORBIDDEN,403,FORBIDDEN,",
            "403,BOARD_LOCKED,403,FACILITY_LOCKED,",
            "404,NOT_FOUND,404,NOT_FOUND,noticeId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "503,NOTICE_WRITE_UNAVAILABLE,503,SERVICE_UNAVAILABLE,",
            "422,NOTICE_BODY_TOO_LONG,422,OUT_OF_RANGE,body",
            "422,NOTICE_COMMENT_TOO_LONG,422,OUT_OF_RANGE,text",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,MEMBER_ONLY,502,UPSTREAM_CONTRACT_ERROR,"})
    void relaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_PATCH, request -> error(upstreamStatus, upstreamCode));
        var result = mockMvc.perform(write(patch(PUBLIC + "/" + N1), "{\"body\":\"본문\"}"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    @Test
    @DisplayName("읽기도 같은 매핑이다 — 비주민 403, 게시판 잠김 403 FACILITY_LOCKED")
    void readsRelayResidencyAndFacilityVerdicts() throws Exception {
        DATA.on(DATA_LIST, request -> error(403, "MEMBER_ONLY"));
        mockMvc.perform(auth(get(PUBLIC))).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        DATA.on(DATA_DETAIL, request -> error(403, "BOARD_LOCKED"));
        mockMvc.perform(auth(get(PUBLIC + "/" + N1))).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
    }

    @Test
    @DisplayName("AT 없이는 401, 경로 id 가 UUID 가 아니면 400 — 상류를 부르지 않는다")
    void requiresSessionAndCanonicalIds() throws Exception {
        mockMvc.perform(get(PUBLIC)).andExpect(status().isUnauthorized());
        mockMvc.perform(auth(get(PUBLIC + "/not-a-uuid")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("noticeId"));
        mockMvc.perform(auth(get("/islands/not-a-uuid/notices")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("islandId"));
        assertThat(DATA.received()).isEmpty();
    }

    // ---------------------------------------------------------------- 도구

    private static List<String> queryParams(String query) {
        return query == null ? List.of() : List.of(query.split("&"));
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
