package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 편지 3종 공개 표면 (GROMO-1933) — 무접두 경로가 Business 에 있고 Data 로는
 * {@code /internal/users/{userId}/…} 로만 나간다는 것을 실제 필터·컨트롤러·HTTP 로 확인한다.
 */
class LetterContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000033");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000033");
    private static final UUID PEER = UUID.fromString("cccccccc-0000-0000-0000-000000000033");
    private static final UUID LETTER = UUID.fromString("dddddddd-0000-0000-0000-000000000033");
    private static final String INTERNAL = "/internal/users/" + USER;
    private static final String DATA_SEND = "POST " + INTERNAL + "/letters";
    private static final String DATA_LIST = "GET " + INTERNAL + "/letters";
    private static final String DATA_DETAIL = "GET " + INTERNAL + "/letters/" + LETTER;
    private static final String SEND_BODY = "{\"receiverId\":\"" + PEER + "\",\"content\":\"안녕\"}";
    private static final String VIEW = "{\"id\":\"" + LETTER + "\",\"senderId\":\"" + USER + "\","
            + "\"senderNickname\":\"나\",\"receiverId\":\"" + PEER + "\",\"content\":\"안녕\","
            + "\"createdAt\":\"2026-09-18T01:00:00Z\",\"readAt\":null}";
    private static final String SLICE = "{\"content\":[{\"id\":\"" + LETTER + "\","
            + "\"counterpartUserId\":\"" + PEER + "\",\"counterpartNickname\":\"짝꿍\","
            + "\"content\":\"안녕\",\"isRead\":false,\"createdAt\":\"2026-09-18T01:00:00Z\"}],"
            + "\"size\":20,\"hasNext\":false,\"nextCursor\":null}";

    @Test
    void sendForwardsSignedActorAndReturnsCreatedLetter() throws Exception {
        DATA.on(DATA_SEND, request -> new MockUpstream.Response(201, VIEW));
        mockMvc.perform(write(post("/letters"), SEND_BODY).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(LETTER.toString()))
                .andExpect(jsonPath("$.data.senderId").value(USER.toString()))
                .andExpect(jsonPath("$.data.readAt").doesNotExist());
        assertThat(DATA.hits(DATA_SEND)).isEqualTo(1);
        var sent = DATA.received().get(0);
        assertThat(sent.header("x-user-id")).isEqualTo(USER.toString());
        // 멱등키 적용표(api-platform LLD §2)에 없는 명령이다 — 앱이 보내지 않았으니 상류로도 나가지 않는다.
        assertThat(sent.header("idempotency-key")).isNull();
        assertThat(sent.body()).contains(PEER.toString()).contains("안녕");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]",
            "{\"receiverId\":\"cccccccc-0000-0000-0000-000000000033\"}",
            "{\"content\":\"x\"}", "{\"receiverId\":1,\"content\":\"x\"}",
            "{\"receiverId\":\"cccccccc-0000-0000-0000-000000000033\",\"content\":5}",
            "{\"receiverId\":\"cccccccc-0000-0000-0000-000000000033\",\"content\":\"x\",\"extra\":1}"})
    void sendRejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(write(post("/letters"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void sendRejectsMalformedReceiverAndRequiresSignedSession() throws Exception {
        mockMvc.perform(write(post("/letters"), "{\"receiverId\":\"1-2-3-4-5\",\"content\":\"x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("receiverId"));
        mockMvc.perform(post("/letters").contentType(MediaType.APPLICATION_JSON).content(SEND_BODY))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    /** 빈 2xx 나 필수 키(createdAt 포함 — DB NOT NULL)가 빠진 응답은 계약 불일치(502)로 올린다. */
    @ParameterizedTest
    @ValueSource(strings = {"", "null", "{}",
            "{\"id\":null,\"senderId\":\"aaaaaaaa-0000-0000-0000-000000000033\"}",
            "{\"id\":\"dddddddd-0000-0000-0000-000000000033\","
                    + "\"senderId\":\"aaaaaaaa-0000-0000-0000-000000000033\","
                    + "\"receiverId\":\"cccccccc-0000-0000-0000-000000000033\","
                    + "\"content\":\"x\",\"readAt\":null}",
            "{\"id\":\"dddddddd-0000-0000-0000-000000000033\","
                    + "\"senderId\":\"aaaaaaaa-0000-0000-0000-000000000033\","
                    + "\"receiverId\":\"cccccccc-0000-0000-0000-000000000033\","
                    + "\"content\":\"x\",\"createdAt\":null,\"readAt\":null}"})
    void sendRejectsEmptyOrIncompleteUpstreamBody(String body) throws Exception {
        DATA.on(DATA_SEND, request -> ok(body));
        mockMvc.perform(write(post("/letters"), SEND_BODY))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void listPassesOptionalParamsThroughAndReturnsSliceInEnvelope() throws Exception {
        DATA.on(DATA_LIST, request -> ok(SLICE));
        mockMvc.perform(auth(get("/letters")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[0].id").value(LETTER.toString()))
                .andExpect(jsonPath("$.data.content[0].counterpartUserId").value(PEER.toString()))
                .andExpect(jsonPath("$.data.content[0].isRead").value(false))
                .andExpect(jsonPath("$.data.hasNext").value(false));
        assertThat(DATA.received().get(0).query()).isNull();
    }

    @Test
    void listForwardsGivenParamsVerbatim() throws Exception {
        DATA.on(DATA_LIST, request -> ok(SLICE));
        mockMvc.perform(auth(get("/letters"))
                        .queryParam("type", "sent").queryParam("size", "2")
                        .queryParam("cursor", LETTER.toString()))
                .andExpect(status().isOk());
        String query = DATA.received().get(0).query();
        assertThat(query).contains("type=sent").contains("size=2").contains("cursor=" + LETTER);
    }

    /**
     * 형식이 아예 깨진 파라미터는 공개 경계에서 거절한다 — 넘기면 Data 의 UUID/Integer 변환 실패가
     * 매핑표에 없는 400 이라 공개 502 가 된다. 값의 범위·의미 판정은 계속 Data 몫이다.
     */
    @ParameterizedTest
    @CsvSource({"cursor,not-a-uuid,cursor", "cursor,1-2-3-4-5,cursor", "size,abc,size",
            "size,2.5,size", "size,'',size"})
    void listRejectsMalformedCursorAndSizeBeforeNetwork(String param, String value, String field)
            throws Exception {
        mockMvc.perform(auth(get("/letters")).param(param, value))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value(field));
        assertThat(DATA.received()).isEmpty();
    }

    /** 숫자인 size 는 범위 판정을 위해 Data 까지 간다 — Data 의 거절이 field=size 로 번역된다. */
    @Test
    void listLetsNumericSizeReachUpstreamRangeCheck() throws Exception {
        DATA.on(DATA_LIST, request -> error(400, "INVALID_PAGE_REQUEST"));
        mockMvc.perform(auth(get("/letters")).param("size", "0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("size"));
        assertThat(DATA.hits(DATA_LIST)).isEqualTo(1);
    }

    /** 항목이나 봉투의 필수 키가 빠지면 계약 불일치다 — 이름이 바뀐 배포를 조용히 통과시키지 않는다. */
    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"content\":null,\"size\":20,\"hasNext\":false}",
            "{\"content\":[],\"hasNext\":false}",
            "{\"content\":[{\"id\":\"dddddddd-0000-0000-0000-000000000033\"}],\"size\":20,\"hasNext\":false}",
            "{\"content\":[{\"id\":\"dddddddd-0000-0000-0000-000000000033\","
                    + "\"counterpartUserId\":\"cccccccc-0000-0000-0000-000000000033\","
                    + "\"content\":\"x\",\"isRead\":false}],\"size\":20,\"hasNext\":false}",
            "{\"content\":[{\"id\":\"dddddddd-0000-0000-0000-000000000033\","
                    + "\"counterpartUserId\":\"cccccccc-0000-0000-0000-000000000033\","
                    + "\"content\":\"x\",\"isRead\":false,\"createdAt\":null}],\"size\":20,\"hasNext\":false}"})
    void listRejectsIncompleteSlice(String body) throws Exception {
        DATA.on(DATA_LIST, request -> ok(body));
        mockMvc.perform(auth(get("/letters")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void detailForwardsLetterIdAndRejectsMalformedIdBeforeNetwork() throws Exception {
        DATA.on(DATA_DETAIL, request -> ok(VIEW));
        mockMvc.perform(auth(get("/letters/" + LETTER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(LETTER.toString()))
                .andExpect(jsonPath("$.data.senderNickname").value("나"));
        mockMvc.perform(auth(get("/letters/1-2-3-4-5")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("letterId"));
        assertThat(DATA.hits(DATA_DETAIL)).isEqualTo(1);
    }

    @ParameterizedTest
    @CsvSource({"400,SELF_LETTER,400,INVALID_PARAMETER,receiverId",
            "400,LETTER_CONTENT_BLANK,400,INVALID_REQUEST,",
            "400,LETTER_CONTENT_OUT_OF_RANGE,400,INVALID_PARAMETER,content",
            "404,LETTER_RECIPIENT_NOT_FRIEND,404,NOT_FOUND,receiverId",
            "404,TARGET_USER_NOT_FOUND,404,NOT_FOUND,receiverId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "422,LETTER_CONTENT_OUT_OF_RANGE,502,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_LETTER_ERROR,502,UPSTREAM_CONTRACT_ERROR,"})
    void sendMapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_SEND, request -> error(upstreamStatus, code));
        var result = mockMvc.perform(write(post("/letters"), SEND_BODY))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
    }

    /** 우체통 미완공은 공개 FACILITY_LOCKED 다 — Data 의 도메인 이름을 그대로 새지 않는다. */
    @ParameterizedTest
    @CsvSource({"403,LETTER_MAILBOX_LOCKED,403,FACILITY_LOCKED,",
            "400,INVALID_PAGE_REQUEST,400,INVALID_PARAMETER,size",
            "400,INVALID_MAILBOX_TYPE,400,INVALID_PARAMETER,type"})
    void listMapsMailboxGateAndPageFailures(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_LIST, request -> error(upstreamStatus, code));
        mockMvc.perform(auth(get("/letters")))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field));
    }

    @ParameterizedTest
    @CsvSource({"404,LETTER_NOT_FOUND,404,NOT_FOUND,letterId",
            "403,NOT_LETTER_PARTICIPANT,403,FORBIDDEN,letterId",
            "403,LETTER_MAILBOX_LOCKED,403,FACILITY_LOCKED,"})
    void detailMapsDomainFailuresWithLetterIdField(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_DETAIL, request -> error(upstreamStatus, code));
        mockMvc.perform(auth(get("/letters/" + LETTER)))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
