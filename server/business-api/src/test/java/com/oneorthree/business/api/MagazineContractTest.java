package com.oneorthree.business.api;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 고양이 잡지 읽기 공개 4종(GROMO-2289 발행)의 계약 — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다: 공개 필드와
 * null 키 유지, 한 호 펼치기의 서명 커서(첫 페이지 무경계·왕복·호/limit 묶임)와 {@code limit}, 받기 본문의 모양, 상류
 * 판정의 공개 오류 매핑, 공개 문서의 필드. 발행·7호 범위·받기 판정은 data-api 가 실제 DB 로 본다.
 */
class MagazineContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-2289-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-2289-0000-0000-000000000001");
    private static final UUID ISSUE = UUID.fromString("01990000-2289-7000-8000-00000000a001");
    private static final UUID OTHER_ISSUE = UUID.fromString("01990000-2289-7000-8000-00000000a002");
    private static final UUID ISLAND = UUID.fromString("cccccccc-2289-0000-0000-000000000001");
    private static final UUID PROMOTION = UUID.fromString("01990000-2289-7000-8000-00000000b001");

    private static final String INTERNAL = "/internal/users/" + USER + "/magazine";
    private static final String DATA_TODAY = "GET " + INTERNAL + "/today";
    private static final String DATA_ISSUES = "GET " + INTERNAL + "/issues";
    private static final String DATA_ISSUE = "GET " + INTERNAL + "/issues/" + ISSUE;
    private static final String DATA_OTHER_ISSUE = "GET " + INTERNAL + "/issues/" + OTHER_ISSUE;
    private static final String DATA_RECEIPT = "PUT " + INTERNAL + "/issues/" + ISSUE + "/receipt";

    private static final String PUBLIC_ISSUE = "/me/magazine/issues/" + ISSUE;
    private static final String PUBLIC_RECEIPT = PUBLIC_ISSUE + "/receipt";

    private static final String ISSUE_HEAD = "{\"issueId\":\"" + ISSUE + "\",\"issueNo\":12,\"issueDate\":\"2026-10-15\","
            + "\"publishedAt\":\"2026-10-14T22:00:00Z\",\"current\":true}";
    private static final String RECEIPT = "{\"place\":\"ISLAND\",\"receivedAt\":\"2026-10-14T23:00:00Z\","
            + "\"deferredAt\":null,\"openedAt\":null}";
    private static final String EDITORIAL = "{\"ranking\":[{\"rank\":1,\"islandId\":\"" + ISLAND + "\",\"name\":\"모래섬\","
            + "\"buildingCount\":5,\"memberCount\":3,\"maxMembers\":15,\"averageFocusMinutesPerDay\":null,"
            + "\"relation\":\"NONE\"}],\"newIslands\":[{\"islandId\":\"" + ISLAND + "\",\"name\":\"모래섬\","
            + "\"buildingCount\":5,\"memberCount\":3,\"maxMembers\":15,\"averageFocusMinutesPerDay\":null,"
            + "\"relation\":\"MEMBER\"}],\"note\":{\"type\":\"TIP\",\"body\":null,\"tipNo\":3}}";
    /** Business 가 속을 보지 않는 layout — 모르는 키·중첩까지 그대로 오간다. */
    private static final String CELL = "{\"promotionId\":\"" + PROMOTION + "\",\"islandId\":\"" + ISLAND + "\","
            + "\"name\":\"모래섬\",\"buildingCount\":5,\"memberCount\":3,\"maxMembers\":15,"
            + "\"averageFocusMinutesPerDay\":62,\"body\":\"놀러 오세요\",\"layout\":{\"v\":1,\"future\":{\"nested\":[1,2]}},"
            + "\"relation\":\"KICKED\"}";

    // ---------------------------------------------------------------- 오늘 호

    @Test
    @DisplayName("오늘 호는 issue·receipt 를 그대로 싣고 미루기·펼치기 전 시각은 null 로 키를 유지한다 — 서명된 주체만 상류로 간다")
    void todayRelaysTheIssueAndReceipt() throws Exception {
        DATA.on(DATA_TODAY, request -> ok("{\"issue\":" + ISSUE_HEAD + ",\"receipt\":" + RECEIPT + "}"));

        mockMvc.perform(auth(get("/me/magazine/today")).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.issue.issueId").value(ISSUE.toString()))
                .andExpect(jsonPath("$.data.issue.issueNo").value(12))
                .andExpect(jsonPath("$.data.issue.issueDate").value("2026-10-15"))
                .andExpect(jsonPath("$.data.issue.publishedAt").value("2026-10-14T22:00:00Z"))
                .andExpect(jsonPath("$.data.issue.current").value(true))
                .andExpect(jsonPath("$.data.receipt.place").value("ISLAND"))
                .andExpect(jsonPath("$.data.receipt.receivedAt").value("2026-10-14T23:00:00Z"))
                .andExpect(jsonPath("$.data.receipt.deferredAt").hasJsonPath())
                .andExpect(jsonPath("$.data.receipt.deferredAt").value((Object) null))
                .andExpect(jsonPath("$.data.receipt.openedAt").hasJsonPath())
                .andExpect(jsonPath("$.data.receipt.openedAt").value((Object) null));
        assertThat(DATA.receivedFor(DATA_TODAY).get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("아직 낸 호도 받은 기록도 없으면 issue·receipt 를 null 로 키를 유지한다")
    void todayKeepsNullIssueAndReceipt() throws Exception {
        DATA.on(DATA_TODAY, request -> ok("{\"issue\":null,\"receipt\":null}"));

        mockMvc.perform(auth(get("/me/magazine/today")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.issue").hasJsonPath())
                .andExpect(jsonPath("$.data.issue").value((Object) null))
                .andExpect(jsonPath("$.data.receipt").hasJsonPath())
                .andExpect(jsonPath("$.data.receipt").value((Object) null));
    }

    @Test
    @DisplayName("오늘 호는 멱등 GET 이라 상류 일시 실패를 재시도한다")
    void todayRetriesATransientFailure() throws Exception {
        DATA.failThenSucceed(DATA_TODAY, 1, 503, "{\"issue\":null,\"receipt\":null}");

        mockMvc.perform(auth(get("/me/magazine/today"))).andExpect(status().isOk());
        assertThat(DATA.hits(DATA_TODAY)).isEqualTo(2);
    }

    @Test
    @DisplayName("오늘 호의 사용자 없음은 USER_NOT_FOUND 로 옮기고, receipt 키가 빠지면 계약 위반이다")
    void todayRelaysUserNotFoundAndRejectsDrift() throws Exception {
        DATA.on(DATA_TODAY, request -> error(404, "USER_NOT_FOUND"));
        mockMvc.perform(auth(get("/me/magazine/today")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));

        DATA.on(DATA_TODAY, request -> ok("{\"issue\":null}"));
        mockMvc.perform(auth(get("/me/magazine/today")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 최근 7호

    @Test
    @DisplayName("최근 호 목록은 items 를 그대로 싣고 쿼리를 보내지 않으며, 일시 실패를 재시도한다")
    void issuesRelayTheListAndRetry() throws Exception {
        DATA.failThenSucceed(DATA_ISSUES, 1, 503, "{\"items\":[{\"issueId\":\"" + ISSUE + "\",\"issueNo\":12,"
                + "\"issueDate\":\"2026-10-15\",\"publishedAt\":\"2026-10-14T22:00:00Z\",\"opened\":true}]}");

        mockMvc.perform(auth(get("/me/magazine/issues")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(1))
                .andExpect(jsonPath("$.data.items[0].issueId").value(ISSUE.toString()))
                .andExpect(jsonPath("$.data.items[0].issueNo").value(12))
                .andExpect(jsonPath("$.data.items[0].issueDate").value("2026-10-15"))
                .andExpect(jsonPath("$.data.items[0].publishedAt").value("2026-10-14T22:00:00Z"))
                .andExpect(jsonPath("$.data.items[0].opened").value(true));
        assertThat(DATA.hits(DATA_ISSUES)).isEqualTo(2);
        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_ISSUES).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.query()).isNullOrEmpty();
    }

    // ---------------------------------------------------------------- 한 호 펼치기

    @Test
    @DisplayName("한 호 첫 페이지는 경계 없이 limit 30 을 보내고, 다음 커서로 부르면 푼 경계를 상류에 보낸다 — 뒤 페이지는 editorial·nextCursor 를 null 로 유지한다")
    void issuePagesWithASignedCursor() throws Exception {
        DATA.on(DATA_ISSUE, request -> request.query().contains("afterAppliedAt")
                ? ok(page("null", "null", "null"))
                : ok(page(EDITORIAL, "\"2026-10-14T05:00:00Z\"", "\"" + PROMOTION + "\"")));

        MvcResult first = mockMvc.perform(auth(get(PUBLIC_ISSUE)).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.issue.issueId").value(ISSUE.toString()))
                .andExpect(jsonPath("$.data.issue.current").value(true))
                .andExpect(jsonPath("$.data.editorial.ranking[0].rank").value(1))
                .andExpect(jsonPath("$.data.editorial.ranking[0].islandId").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.editorial.ranking[0].name").value("모래섬"))
                .andExpect(jsonPath("$.data.editorial.ranking[0].buildingCount").value(5))
                .andExpect(jsonPath("$.data.editorial.ranking[0].memberCount").value(3))
                .andExpect(jsonPath("$.data.editorial.ranking[0].maxMembers").value(15))
                .andExpect(jsonPath("$.data.editorial.ranking[0].averageFocusMinutesPerDay").hasJsonPath())
                .andExpect(jsonPath("$.data.editorial.ranking[0].averageFocusMinutesPerDay").value((Object) null))
                .andExpect(jsonPath("$.data.editorial.ranking[0].relation").value("NONE"))
                .andExpect(jsonPath("$.data.editorial.newIslands[0].relation").value("MEMBER"))
                .andExpect(jsonPath("$.data.editorial.newIslands[0].averageFocusMinutesPerDay").hasJsonPath())
                .andExpect(jsonPath("$.data.editorial.newIslands[0].rank").doesNotExist())
                .andExpect(jsonPath("$.data.editorial.note.type").value("TIP"))
                .andExpect(jsonPath("$.data.editorial.note.body").hasJsonPath())
                .andExpect(jsonPath("$.data.editorial.note.body").value((Object) null))
                .andExpect(jsonPath("$.data.editorial.note.tipNo").value(3))
                .andExpect(jsonPath("$.data.cells[0].promotionId").value(PROMOTION.toString()))
                .andExpect(jsonPath("$.data.cells[0].islandId").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.cells[0].averageFocusMinutesPerDay").value(62))
                .andExpect(jsonPath("$.data.cells[0].body").value("놀러 오세요"))
                .andExpect(jsonPath("$.data.cells[0].layout.future.nested[1]").value(2))
                .andExpect(jsonPath("$.data.cells[0].relation").value("KICKED"))
                .andExpect(jsonPath("$.data.nextAppliedAt").doesNotExist())
                .andExpect(jsonPath("$.data.nextPromotionId").doesNotExist())
                .andExpect(jsonPath("$.data.nextCursor").isNotEmpty())
                .andReturn();
        MockUpstream.RecordedRequest firstCall = DATA.receivedFor(DATA_ISSUE).get(0);
        assertThat(firstCall.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(firstCall.query()).as("첫 페이지는 경계를 싣지 않고 기본 limit 은 30 이다")
                .isEqualTo("limit=30");

        String cursor = JsonPath.read(first.getResponse().getContentAsString(), "$.data.nextCursor");
        mockMvc.perform(auth(get(PUBLIC_ISSUE)).param("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.editorial").hasJsonPath())
                .andExpect(jsonPath("$.data.editorial").value((Object) null))
                .andExpect(jsonPath("$.data.nextCursor").hasJsonPath())
                .andExpect(jsonPath("$.data.nextCursor").value((Object) null));
        assertThat(DATA.receivedFor(DATA_ISSUE).get(1).query())
                .contains("afterAppliedAt=2026-10-14T05")
                .contains("afterPromotionId=" + PROMOTION)
                .contains("limit=30");
    }

    @Test
    @DisplayName("커서는 낸 호와 limit 에 묶인다 — 다른 호·다른 limit 에 내밀면 상류 전에 400 INVALID_CURSOR 다")
    void cursorIsBoundToTheIssueAndLimit() throws Exception {
        DATA.on(DATA_ISSUE, request -> ok(page("null", "\"2026-10-14T05:00:00Z\"", "\"" + PROMOTION + "\"")));
        MvcResult first = mockMvc.perform(auth(get(PUBLIC_ISSUE))).andExpect(status().isOk()).andReturn();
        String cursor = JsonPath.read(first.getResponse().getContentAsString(), "$.data.nextCursor");

        mockMvc.perform(auth(get("/me/magazine/issues/" + OTHER_ISSUE)).param("cursor", cursor))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        mockMvc.perform(auth(get(PUBLIC_ISSUE)).param("cursor", cursor).param("limit", "5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        mockMvc.perform(auth(get(PUBLIC_ISSUE)).param("cursor", "ci.Zm9yZ2Vk.".concat("A".repeat(43))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.hits(DATA_OTHER_ISSUE)).isZero();
        assertThat(DATA.hits(DATA_ISSUE)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "100"})
    @DisplayName("limit 1~100 은 그대로 상류에 간다")
    void issueForwardsAnInRangeLimit(String limit) throws Exception {
        DATA.on(DATA_ISSUE, request -> ok(page("null", "null", "null")));

        mockMvc.perform(auth(get(PUBLIC_ISSUE + "?limit=" + limit))).andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_ISSUE).get(0).query()).isEqualTo("limit=" + limit);
    }

    @ParameterizedTest
    @CsvSource({"0,422,OUT_OF_RANGE", "101,422,OUT_OF_RANGE", "-1,422,OUT_OF_RANGE", "abc,400,INVALID_PARAMETER",
            "1.5,400,INVALID_PARAMETER", "'',400,INVALID_PARAMETER"})
    @DisplayName("limit 이 정수가 아니면 400, 1~100 밖이면 422 — 상류를 부르지 않는다")
    void issueRejectsABadLimit(String limit, int status, String code) throws Exception {
        mockMvc.perform(auth(get(PUBLIC_ISSUE + "?limit=" + limit)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("limit 을 두 번 보내거나 호 id 가 UUID 가 아니면 상류 전에 400 INVALID_PARAMETER 다")
    void issueRejectsARepeatedLimitAndANonUuidIssue() throws Exception {
        mockMvc.perform(auth(get(PUBLIC_ISSUE + "?limit=1&limit=2")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("limit"));
        mockMvc.perform(auth(get("/me/magazine/issues/not-a-uuid")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("issueId"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "404,MAGAZINE_ISSUE_NOT_FOUND,404,MAGAZINE_ISSUE_NOT_FOUND",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND",
            "409,MAGAZINE_ISSUE_NOT_FOUND,400,UPSTREAM_CONTRACT_ERROR",
            "400,UNKNOWN_MAGAZINE_ERROR,400,UPSTREAM_CONTRACT_ERROR"})
    @DisplayName("한 호 펼치기는 정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 계약 위반이다")
    void issueRelaysDataVerdicts(int upstreamStatus, String upstreamCode, int status, String code) throws Exception {
        DATA.on(DATA_ISSUE, request -> error(upstreamStatus, upstreamCode));

        mockMvc.perform(auth(get(PUBLIC_ISSUE)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    @DisplayName("없는 호는 404 MAGAZINE_ISSUE_NOT_FOUND 와 공개 문구로 나간다")
    void issueNotFoundCarriesThePublicMessage() throws Exception {
        DATA.on(DATA_ISSUE, request -> error(404, "MAGAZINE_ISSUE_NOT_FOUND"));

        mockMvc.perform(auth(get(PUBLIC_ISSUE)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.message").value("잡지 호를 찾을 수 없어요"));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            // 다음 경계가 반쪽이다.
            "\"2026-10-14T05:00:00Z\"|null",
            "null|\"01990000-2289-7000-8000-00000000b001\""})
    @DisplayName("상류의 다음 경계 두 값이 반쪽이면 커서를 만들지 않고 계약 위반으로 접는다")
    void issueRejectsAHalfBoundary(String nextAppliedAt, String nextPromotionId) throws Exception {
        DATA.on(DATA_ISSUE, request -> ok(page("null", nextAppliedAt, nextPromotionId)));

        mockMvc.perform(auth(get(PUBLIC_ISSUE)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            // editorial 키 자체가 빠졌다 — null 과 다르다.
            "{\"issue\":{i},\"cells\":[],\"nextAppliedAt\":null,\"nextPromotionId\":null}",
            // 다음 경계 키 둘이 다 빠졌다 — 마지막 페이지(null 쌍)로 오인하면 다음 칸을 잃는다.
            "{\"issue\":{i},\"editorial\":null,\"cells\":[]}",
            // 다음 경계 키 하나만 빠졌다.
            "{\"issue\":{i},\"editorial\":null,\"cells\":[],\"nextAppliedAt\":null}",
            // averageFocusMinutesPerDay 키가 빠졌다.
            "{\"issue\":{i},\"editorial\":null,\"cells\":[{\"promotionId\":\"01990000-2289-7000-8000-00000000b001\","
                    + "\"islandId\":\"cccccccc-2289-0000-0000-000000000001\",\"name\":\"x\",\"buildingCount\":1,"
                    + "\"memberCount\":1,\"maxMembers\":15,\"body\":\"x\",\"layout\":{},\"relation\":\"NONE\"}],"
                    + "\"nextAppliedAt\":null,\"nextPromotionId\":null}",
            // layout 이 객체가 아니다.
            "{\"issue\":{i},\"editorial\":null,\"cells\":[{\"promotionId\":\"01990000-2289-7000-8000-00000000b001\","
                    + "\"islandId\":\"cccccccc-2289-0000-0000-000000000001\",\"name\":\"x\",\"buildingCount\":1,"
                    + "\"memberCount\":1,\"maxMembers\":15,\"averageFocusMinutesPerDay\":null,\"body\":\"x\","
                    + "\"layout\":[],\"relation\":\"NONE\"}],\"nextAppliedAt\":null,\"nextPromotionId\":null}"})
    @DisplayName("한 호 응답이 어긋나면 계약 위반으로 접는다")
    void issueRejectsADriftingUpstreamBody(String body) throws Exception {
        DATA.on(DATA_ISSUE, request -> ok(body.replace("{i}", ISSUE_HEAD)));

        mockMvc.perform(auth(get(PUBLIC_ISSUE)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 받기 기록

    @Test
    @DisplayName("받기 기록은 {place, deferred, opened} 를 명령 키 없이 상류에 보내고 200 {place, receivedAt, deferredAt, openedAt} 을 싣는다")
    void receiptForwardsTheBodyWithoutAKey() throws Exception {
        DATA.on(DATA_RECEIPT, request -> ok("{\"place\":\"SEA\",\"receivedAt\":\"2026-10-14T23:00:00Z\","
                + "\"deferredAt\":\"2026-10-14T23:01:00Z\",\"openedAt\":null}"));

        mockMvc.perform(json(put(PUBLIC_RECEIPT), "{\"place\":\"SEA\",\"deferred\":true,\"opened\":false}")
                        .header("X-User-Id", UUID.randomUUID()).header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.place").value("SEA"))
                .andExpect(jsonPath("$.data.receivedAt").value("2026-10-14T23:00:00Z"))
                .andExpect(jsonPath("$.data.deferredAt").value("2026-10-14T23:01:00Z"))
                .andExpect(jsonPath("$.data.openedAt").hasJsonPath())
                .andExpect(jsonPath("$.data.openedAt").value((Object) null));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_RECEIPT).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).as("명령 키를 요구하지도 옮기지도 않는다").isNull();
        assertSameJson(forwarded.body(), "{\"place\":\"SEA\",\"deferred\":true,\"opened\":false}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"place\":\"ISLAND\"}", "{\"place\":\"ISLAND\",\"deferred\":null,\"opened\":null}"})
    @DisplayName("deferred·opened 는 빠지거나 null 이어도 된다 — place 만 상류에 실린다")
    void receiptAcceptsAbsentFlags(String body) throws Exception {
        DATA.on(DATA_RECEIPT, request -> ok(RECEIPT));

        mockMvc.perform(json(put(PUBLIC_RECEIPT), body)).andExpect(status().isOk());
        var forwarded = new tools.jackson.databind.ObjectMapper().readTree(DATA.receivedFor(DATA_RECEIPT).get(0).body());
        assertThat(forwarded.get("place").stringValue()).isEqualTo("ISLAND");
        assertThat(forwarded.path("deferred").isMissingNode() || forwarded.path("deferred").isNull()).isTrue();
        assertThat(forwarded.path("opened").isMissingNode() || forwarded.path("opened").isNull()).isTrue();
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', nullValues = "-", value = {
            "{}|place",
            "{\"place\":null}|place",
            "{\"place\":\"HOME\"}|place",
            "{\"place\":\"sea\"}|place",
            "{\"place\":1}|place",
            "{\"place\":\"SEA\",\"deferred\":\"true\"}|deferred",
            "{\"place\":\"SEA\",\"opened\":1}|opened",
            "{\"place\":\"SEA\",\"userId\":\"x\"}|-",
            "[]|-",
            "\"SEA\"|-"})
    @DisplayName("받기 본문이 {place: SEA|ISLAND, deferred?: boolean, opened?: boolean} 가 아니면 400 INVALID_REQUEST — 상류를 부르지 않는다")
    void receiptRejectsAMalformedBodyBeforeUpstream(String body, String field) throws Exception {
        var result = mockMvc.perform(json(put(PUBLIC_RECEIPT), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        if (field == null) {
            result.andExpect(jsonPath("$.error.field").doesNotExist());
        } else {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("받기 본문이 JSON 이 아니거나 호 id 가 UUID 가 아니면 상류 전에 400 이다")
    void receiptRejectsGarbageAndANonUuidIssue() throws Exception {
        mockMvc.perform(json(put(PUBLIC_RECEIPT), "{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        mockMvc.perform(json(put("/me/magazine/issues/not-a-uuid/receipt"), "{\"place\":\"SEA\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("issueId"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "404,MAGAZINE_ISSUE_NOT_FOUND,404,MAGAZINE_ISSUE_NOT_FOUND",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND",
            "400,INVALID_REQUEST,400,INVALID_REQUEST",
            "409,MAGAZINE_ISSUE_NOT_FOUND,400,UPSTREAM_CONTRACT_ERROR"})
    @DisplayName("받기 기록은 정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮긴다")
    void receiptRelaysDataVerdictsWithoutRetry(int upstreamStatus, String upstreamCode, int status, String code)
            throws Exception {
        DATA.on(DATA_RECEIPT, request -> error(upstreamStatus, upstreamCode));

        mockMvc.perform(json(put(PUBLIC_RECEIPT), "{\"place\":\"SEA\"}"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        assertThat(DATA.hits(DATA_RECEIPT)).isEqualTo(1);
    }

    @Test
    @DisplayName("받기 기록은 명령 키 없는 PUT 이라 상류 일시 실패를 재시도하지 않는다")
    void receiptDoesNotRetryATransientFailure() throws Exception {
        DATA.failThenSucceed(DATA_RECEIPT, 1, 503, RECEIPT);

        mockMvc.perform(json(put(PUBLIC_RECEIPT), "{\"place\":\"SEA\"}"))
                .andExpect(jsonPath("$.data").doesNotExist());
        assertThat(DATA.hits(DATA_RECEIPT)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 공개 문서

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/me/magazine/today|get||issue receipt",
            "/me/magazine/today|get|issue|issueId issueNo issueDate publishedAt current",
            "/me/magazine/today|get|receipt|place receivedAt deferredAt openedAt",
            "/me/magazine/issues|get||items",
            "/me/magazine/issues|get|items|issueId issueNo issueDate publishedAt opened",
            "/me/magazine/issues/{issueId}|get||issue editorial cells nextCursor",
            "/me/magazine/issues/{issueId}|get|editorial|ranking newIslands note",
            "/me/magazine/issues/{issueId}|get|editorial/ranking|rank islandId name buildingCount memberCount maxMembers averageFocusMinutesPerDay relation",
            "/me/magazine/issues/{issueId}|get|editorial/newIslands|islandId name buildingCount memberCount maxMembers averageFocusMinutesPerDay relation",
            "/me/magazine/issues/{issueId}|get|editorial/note|type body tipNo",
            "/me/magazine/issues/{issueId}|get|cells|promotionId islandId name buildingCount memberCount maxMembers averageFocusMinutesPerDay body layout relation",
            "/me/magazine/issues/{issueId}/receipt|put||place receivedAt deferredAt openedAt"})
    @DisplayName("공개 문서가 각 경로의 응답 필드를 담고, null 일 수 있는 키도 필수(늘 실림)로 적는다")
    void publicDocumentationPreservesFields(String path, String method, String nested, String fields)
            throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path(path).path(method).path("responses").path("200").path("content");
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
        assertThat(required).containsExactlyInAnyOrder(fields.split(" "));
    }

    @Test
    @DisplayName("공개 문서의 칸 layout 은 문자열이 아니라 JSON 객체다")
    void publicDocumentationDescribesLayoutAsAnObject() throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        assertThat(document.at("/components/schemas/MagazineCell/properties/layout/type").asText()).isEqualTo("object");
    }

    // ---------------------------------------------------------------- 도구

    /** Data 의 한 호 한 페이지 — editorial·다음 경계를 JSON 조각으로 받는다. */
    private static String page(String editorial, String nextAppliedAt, String nextPromotionId) {
        return "{\"issue\":" + ISSUE_HEAD + ",\"editorial\":" + editorial + ",\"cells\":[" + CELL + "],"
                + "\"nextAppliedAt\":" + nextAppliedAt + ",\"nextPromotionId\":" + nextPromotionId + "}";
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return auth(request).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    /** 상류로 간 본문이 앱이 보낸 본문과 «JSON 으로» 같다 — 키 순서·공백은 보지 않는다. */
    private static void assertSameJson(String actual, String expected) {
        var mapper = new tools.jackson.databind.ObjectMapper();
        assertThat(mapper.readTree(actual)).isEqualTo(mapper.readTree(expected));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
