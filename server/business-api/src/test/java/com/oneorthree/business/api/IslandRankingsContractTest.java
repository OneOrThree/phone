package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 주간 섬 랭킹 공개 계약 (GROMO-1997) — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다.
 *
 * <p>평균·동결 분모·동점·주 경계의 의미는 data-api 의 {@code IslandRankingsIntegrationTest} 가 본다.
 * 여기서 보는 것은 입력 모양, 공개 모양, 커서 부재, 상류 실패의 공개 오류 표다.
 */
class IslandRankingsContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1997-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1997-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1997-0000-0000-000000000001");

    private static final String DATA = "GET /internal/users/" + USER + "/island-rankings";
    private static final String RANKINGS = "/rankings/islands";

    private static final String PAGE = "{\"week\":\"2026-09-06\",\"items\":[{\"rank\":1,\"islandId\":\"" + ISLAND
            + "\",\"name\":\"소다 섬\",\"averageFocusSeconds\":18000}],\"myRank\":4,"
            + "\"asOf\":\"2026-09-11T09:10:00Z\"}";

    @Test
    @DisplayName("상위 목록·myRank·asOf 를 내리고 nextCursor 는 언제나 없다")
    void returnsTopItemsWithMyRankAndNoCursor() throws Exception {
        UpstreamTestBase.DATA.on(DATA, request -> ok(PAGE));

        mockMvc.perform(auth(get(RANKINGS).param("week", "2026-09-06")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].rank").value(1))
                .andExpect(jsonPath("$.data.items[0].islandId").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.items[0].name").value("소다 섬"))
                .andExpect(jsonPath("$.data.items[0].averageFocusSeconds").value(18000))
                .andExpect(jsonPath("$.data.myRank").value(4))
                .andExpect(jsonPath("$.data.asOf").value("2026-09-11T09:10:00Z"))
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()));

        assertThat(UpstreamTestBase.DATA.receivedFor(DATA).get(0).query().split("&"))
                .containsExactly("week=2026-09-06");
    }

    @Test
    @DisplayName("limit 은 그대로 상류로 넘어간다")
    void forwardsLimit() throws Exception {
        UpstreamTestBase.DATA.on(DATA, request -> ok(PAGE));

        mockMvc.perform(auth(get(RANKINGS).param("week", "2026-09-06").param("limit", "100")))
                .andExpect(status().isOk());

        assertThat(UpstreamTestBase.DATA.receivedFor(DATA).get(0).query().split("&"))
                .containsExactlyInAnyOrder("week=2026-09-06", "limit=100");
    }

    @Test
    @DisplayName("상류가 다른 주를 답하면 400 — 요청한 주와 대조한다")
    void mismatchedWeekIsAContractError() throws Exception {
        UpstreamTestBase.DATA.on(DATA, request -> ok(PAGE.replace("2026-09-06", "2026-08-30")));

        mockMvc.perform(auth(get(RANKINGS).param("week", "2026-09-06")))
                .andExpect(status().is(400))
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @ParameterizedTest
    @CsvSource({"week=2026-9-6,400,INVALID_PARAMETER,week",
        "week=2026-02-30,422,OUT_OF_RANGE,week",
        "'',400,INVALID_PARAMETER,week",
        "week=2026-W37,400,INVALID_PARAMETER,week",
        "week=2026-09-06&limit=0,422,OUT_OF_RANGE,limit",
        "week=2026-09-06&limit=101,422,OUT_OF_RANGE,limit",
        "week=2026-09-06&limit=ten,400,INVALID_PARAMETER,limit",
        "week=2026-09-06&scope=me,400,INVALID_PARAMETER,scope",
        "week=2026-09-06&week=2026-09-13,400,INVALID_PARAMETER,week",
        "week=2026-09-06&cursor=abc,400,INVALID_CURSOR,cursor"})
    @DisplayName("query 모양 — 형식은 400, 없는 날짜·limit 범위는 422. 커서는 발급한 적이 없으므로 400. 상류 호출 없음")
    void rejectsQueries(String query, int status, String code, String field) throws Exception {
        mockMvc.perform(auth(get(RANKINGS + "?" + query)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value(field));
        assertThat(UpstreamTestBase.DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,",
        "403,OBSERVATORY_LOCKED,403,FACILITY_LOCKED,",
        "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
        "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,",
        "422,RANKING_WEEK_OUT_OF_RANGE,422,OUT_OF_RANGE,week",
        "409,OBSERVATORY_LOCKED,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 400 다")
    void mapsDomainFailures(int upstreamStatus, String upstreamCode, int publicStatus, String publicCode,
            String field) throws Exception {
        UpstreamTestBase.DATA.on(DATA, request -> error(upstreamStatus, upstreamCode));

        mockMvc.perform(auth(get(RANKINGS).param("week", "2026-09-06")))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field));
    }

    // ---------------------------------------------------------------- 도구

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
