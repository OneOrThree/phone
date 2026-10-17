package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 잡지 홍보 신청·섬 소식 공개 2종의 계약 (GROMO-2267) — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다: 주체·앱
 * 키·{@code limit} 의 모양, 상류 판정의 공개 오류 매핑, 공개 문서의 필드. 섬장·게스트·잔액·하루 1회·주민의 판정과
 * 차감·소식 쓰기는 data-api 의 {@code IslandPromotionIntegrationTest} 가 실제 DB 로 본다.
 */
class IslandPromotionContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-2267-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-2267-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-2267-0000-0000-000000000001");
    private static final UUID NEWS = UUID.fromString("01990000-2267-7000-8000-000000000001");
    private static final String KEY = "eeeeeeee-2267-4000-8000-000000000001";

    private static final String PUBLIC = "/islands/" + ISLAND;
    private static final String INTERNAL = "/internal/users/" + USER + "/islands/" + ISLAND;
    private static final String DATA_PROMOTE = "POST " + INTERNAL + "/promotions";
    private static final String DATA_NEWS = "GET " + INTERNAL + "/news";

    private static final String CREATED = "{\"feeFish\":60,\"balanceAfter\":40,\"newsId\":\"" + NEWS + "\"}";
    private static final String NEWS_PAGE = "{\"items\":[{\"id\":\"" + NEWS + "\",\"kind\":\"PROMOTION\","
            + "\"body\":\"섬장이 오늘 잡지 홍보에 60마리를 썼어요\",\"createdAt\":\"2026-10-12T05:00:00Z\"},"
            + "{\"id\":\"" + UUID.randomUUID() + "\",\"kind\":\"MAGAZINE_ISSUED\",\"body\":\"모르는 종류도 그대로\","
            + "\"createdAt\":\"2026-10-11T05:00:00Z\"}]}";

    // ---------------------------------------------------------------- 신청

    @Test
    @DisplayName("신청은 201 {feeFish, balanceAfter, newsId} 이고 서명된 주체·앱 키만 본문 없이 상류로 옮긴다 — 공격자 X-User-Id 는 버린다")
    void promoteReturnsCreatedAndForwardsOnlyTheSignedSubjectAndKey() throws Exception {
        DATA.on(DATA_PROMOTE, request -> new MockUpstream.Response(201, CREATED));

        mockMvc.perform(promote().header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.feeFish").value(60))
                .andExpect(jsonPath("$.data.balanceAfter").value(40))
                .andExpect(jsonPath("$.data.newsId").value(NEWS.toString()));

        assertThat(DATA.received()).hasSize(1);
        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_PROMOTE).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.body()).as("홍보 내용은 잡지 담당 범위라 본문이 없다").isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-a-uuid", "eeeeeeee-2267-4000-8000-00000000000"})
    @DisplayName("Idempotency-Key 가 없거나 UUID 가 아니면 400 INVALID_IDEMPOTENCY_KEY — 상류를 부르지 않는다")
    void promoteRequiresAUuidCommandKey(String key) throws Exception {
        MockHttpServletRequestBuilder request = auth(post(PUBLIC + "/promotions"));
        mockMvc.perform(key.isEmpty() ? request : request.header("Idempotency-Key", key))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("섬 id 가 UUID 가 아니면 상류 전에 400 이다")
    void promoteRejectsANonUuidIsland() throws Exception {
        mockMvc.perform(auth(post("/islands/not-a-uuid/promotions")).header("Idempotency-Key", KEY))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "403,NOT_OWNER,403,FORBIDDEN,",
            "403,SOCIAL_LOGIN_REQUIRED,403,SOCIAL_LOGIN_REQUIRED,",
            "409,PROMOTION_ALREADY_REQUESTED_TODAY,409,PROMOTION_ALREADY_REQUESTED_TODAY,",
            "409,INSUFFICIENT_FUNDS,409,INSUFFICIENT_FUNDS,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,NOT_OWNER,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_PROMOTION_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 계약 위반이다")
    void promoteRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_PROMOTE, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(promote())
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    @Test
    @DisplayName("상류 응답에 필수 필드가 빠지면 성공으로 내보내지 않고 계약 위반으로 접는다")
    void promoteRejectsADriftingUpstreamBody() throws Exception {
        String withoutBalance = "{\"feeFish\":60,\"newsId\":\"" + NEWS + "\"}";
        DATA.on(DATA_PROMOTE, request -> new MockUpstream.Response(201, withoutBalance));

        mockMvc.perform(promote())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    // ---------------------------------------------------------------- 소식

    @Test
    @DisplayName("소식은 상류 items 를 그대로 싣고 모르는 kind 도 막지 않으며, limit 을 생략하면 20 을 상류에 보낸다")
    void newsRelaysItemsAndDefaultsTheLimit() throws Exception {
        DATA.on(DATA_NEWS, request -> ok(NEWS_PAGE));

        mockMvc.perform(auth(get(PUBLIC + "/news")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(2))
                .andExpect(jsonPath("$.data.items[0].id").value(NEWS.toString()))
                .andExpect(jsonPath("$.data.items[0].kind").value("PROMOTION"))
                .andExpect(jsonPath("$.data.items[0].body").value("섬장이 오늘 잡지 홍보에 60마리를 썼어요"))
                .andExpect(jsonPath("$.data.items[0].createdAt").value("2026-10-12T05:00:00Z"))
                .andExpect(jsonPath("$.data.items[1].kind").value("MAGAZINE_ISSUED"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_NEWS).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.query()).isEqualTo("limit=20");
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "20", "50"})
    @DisplayName("limit 1~50 은 그대로 상류에 간다")
    void newsForwardsAnInRangeLimit(String limit) throws Exception {
        DATA.on(DATA_NEWS, request -> ok("{\"items\":[]}"));

        mockMvc.perform(auth(get(PUBLIC + "/news?limit=" + limit)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty());
        assertThat(DATA.receivedFor(DATA_NEWS).get(0).query()).isEqualTo("limit=" + limit);
    }

    @ParameterizedTest
    @CsvSource({"0,422,OUT_OF_RANGE", "51,422,OUT_OF_RANGE", "-1,422,OUT_OF_RANGE", "abc,400,INVALID_PARAMETER",
            "1.5,400,INVALID_PARAMETER", "'',400,INVALID_PARAMETER"})
    @DisplayName("limit 이 정수가 아니면 400, 1~50 밖이면 422 — 상류를 부르지 않는다")
    void newsRejectsABadLimit(String limit, int status, String code) throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/news?limit=" + limit)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("limit 을 두 번 보내면 400 INVALID_PARAMETER 다")
    void newsRejectsARepeatedLimit() throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/news?limit=1&limit=2")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "400,INVALID_PAGE_REQUEST,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("소식은 비주민·없는 섬의 판정을 공개 오류로 옮기고 그 밖은 계약 위반이다")
    void newsRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_NEWS, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(auth(get(PUBLIC + "/news")))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    // ---------------------------------------------------------------- 공개 문서

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/islands/{islandId}/promotions|post|201||feeFish balanceAfter newsId|feeFish balanceAfter newsId",
            "/islands/{islandId}/news|get|200||items|items",
            "/islands/{islandId}/news|get|200|items|id kind body createdAt|id kind body createdAt"})
    @DisplayName("공개 문서가 두 경로의 응답 필드와 필수 여부를 그대로 담는다")
    void publicDocumentationPreservesFields(String path, String method, String responseStatus, String nested,
            String fields, String requiredFields) throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path(path).path(method).path("responses").path(responseStatus)
                .path("content");
        var schema = content.iterator().next().path("schema");
        schema = document.at(schema.path("$ref").asText().substring(1));
        if (nested != null) {
            for (String part : nested.split("/")) {
                schema = schema.path("properties").path(part);
                if (schema.path("type").asText().equals("array")) {
                    schema = schema.path("items");
                }
                schema = document.at(schema.path("$ref").asText().substring(1));
            }
        }
        assertThat(schema.path("properties").propertyNames()).containsExactlyInAnyOrder(fields.split(" "));
        var required = new java.util.ArrayList<String>();
        schema.path("required").forEach(value -> required.add(value.asText()));
        assertThat(required).containsExactlyInAnyOrder(requiredFields.split(" "));
    }

    // ---------------------------------------------------------------- 도구

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockHttpServletRequestBuilder promote() {
        return auth(post(PUBLIC + "/promotions")).header("Idempotency-Key", KEY);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
