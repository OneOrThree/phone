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
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 회관 기록 공개 3종의 계약 (GROMO-1769) — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다.
 *
 * <p>집계·측정 저장의 의미(자정 경계·멱등·최신 선택·미측정 구분)는 data-api 의 {@code IslandRecordsIntegrationTest} 가
 * 본다. 여기서 보는 것은 입력 모양, scope 별 공개 모양, 커서 서명, 상류 실패의 공개 오류 표다.
 */
class IslandRecordsContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1769-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1769-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1769-0000-0000-000000000001");
    private static final UUID SNAPSHOT = UUID.fromString("dddddddd-1769-0000-0000-000000000001");
    private static final String KEY = "12345678-1769-5000-8000-000000000001";

    private static final String DATA_FOCUS = "GET /internal/islands/" + ISLAND + "/statistics/focus";
    private static final String DATA_SCREEN = "GET /internal/islands/" + ISLAND + "/statistics/screen-time";
    private static final String DATA_PUT = "PUT /internal/users/" + USER + "/screen-time/2026-09-11";
    private static final String DATA_LEDGER = "GET /internal/islands/" + ISLAND + "/resources/ledger";
    private static final String FOCUS = "/islands/" + ISLAND + "/statistics/focus";
    private static final String SCREEN = "/islands/" + ISLAND + "/statistics/screen-time";
    private static final String UPLOAD = "/me/screen-time/2026-09-11";
    private static final String LEDGER_PATH = "/islands/" + ISLAND + "/resources/ledger";
    private static final String DATA_FISH = "GET /internal/islands/" + ISLAND + "/statistics/fish-earnings";
    private static final String FISH_PATH = "/islands/" + ISLAND + "/statistics/fish-earnings";
    private static final String FISH = "{\"members\":[{\"userId\":\"" + USER + "\",\"name\":\"수빈\","
            + "\"earnedFish\":4800},{\"userId\":\"" + SESSION + "\",\"name\":\"도윤\",\"earnedFish\":0}]}";

    private static final UUID ENTRY = UUID.fromString("eeeeeeee-1786-0000-0000-000000000001");
    private static final String LEDGER = "{\"month\":\"2026-09\",\"earnedTotal\":4800,\"spentTotal\":1360,"
            + "\"items\":[{\"id\":\"" + ENTRY + "\",\"direction\":\"spend\",\"reason\":\"construction_debit\","
            + "\"amount\":1360,\"createdAt\":\"2026-09-11T12:00:00Z\",\"groupedUntil\":\"2026-09-11T12:00:00Z\","
            + "\"entryCount\":1},{\"id\":\"" + SNAPSHOT + "\",\"direction\":\"earn\",\"reason\":\"contribution\","
            + "\"amount\":480,\"createdAt\":\"2026-09-11T00:00:00Z\",\"groupedUntil\":\"2026-09-11T14:00:00Z\","
            + "\"entryCount\":480}],\"nextCreatedAt\":\"2026-09-11T00:00:00Z\",\"nextEntryId\":\"" + ENTRY + "\"}";
    private static final String LEDGER_LAST = "{\"month\":\"2026-09\",\"earnedTotal\":0,\"spentTotal\":0,"
            + "\"items\":[],\"nextCreatedAt\":null,\"nextEntryId\":null}";

    private static final String RECORD = "{\"id\":\"" + SNAPSHOT + "\",\"subject\":\"수학\",\"activeSeconds\":1500,"
            + "\"completedAt\":\"2026-09-11T09:10:00Z\"}";
    private static final String FOCUS_ME = "{\"scope\":\"me\",\"totalSeconds\":1500,\"series\":[{\"date\":\"2026-09-11\","
            + "\"seconds\":1500}],\"records\":[" + RECORD + "],\"members\":null,\"asOf\":\"2026-09-11T09:10:00Z\","
            + "\"nextSnapshotId\":\"" + SNAPSHOT + "\",\"nextOffset\":30}";
    private static final String FOCUS_ISLAND = "{\"scope\":\"island\",\"totalSeconds\":null,\"series\":null,"
            + "\"records\":null,\"members\":[{\"userId\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":null,"
            + "\"totalSeconds\":60,\"series\":[{\"date\":\"2026-09-11\",\"seconds\":60}]}],"
            + "\"asOf\":\"2026-09-11T09:10:00Z\",\"nextSnapshotId\":null,\"nextOffset\":null}";
    private static final String SCREEN_ME = "{\"scope\":\"me\",\"measurementStatus\":\"unavailable\",\"totalMinutes\":null,"
            + "\"series\":[],\"updatedAt\":null,\"members\":null}";
    private static final String SCREEN_ISLAND = "{\"scope\":\"island\",\"measurementStatus\":null,\"totalMinutes\":null,"
            + "\"series\":null,\"updatedAt\":null,\"members\":[{\"userId\":\"" + USER + "\",\"name\":\"수빈\","
            + "\"catColor\":null,\"minutes\":null,\"measurementStatus\":\"denied\",\"series\":[],\"updatedAt\":null}]}";
    private static final String UPLOAD_BODY = "{\"minutes\":90,\"measurementStatus\":\"authorized\",\"timezone\":\"UTC\","
            + "\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"" + SESSION + "\"}";

    // ---------------------------------------------------------------- 집중

    @Test
    @DisplayName("집중 scope=me — 기록 페이지와 서명 커서를 내리고, 커서는 스냅샷 id 를 드러내지 않으며 다음 페이지 경계로 풀린다")
    void focusMePagesWithSignedCursor() throws Exception {
        DATA.on(DATA_FOCUS, request -> ok(FOCUS_ME));

        MvcResult first = mockMvc.perform(auth(get(FOCUS).param("from", "2026-09-07").param("to", "2026-09-13")
                        .param("scope", "me")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.scope").value("me"))
                .andExpect(jsonPath("$.data.totalSeconds").value(1500))
                .andExpect(jsonPath("$.data.records[0].subject").value("수학"))
                .andExpect(jsonPath("$.data.asOf").value("2026-09-11T09:10:00Z"))
                .andExpect(jsonPath("$.data.members").doesNotExist())
                .andReturn();
        assertThat(DATA.receivedFor(DATA_FOCUS).get(0).query().split("&"))
                .containsExactlyInAnyOrder("from=2026-09-07", "to=2026-09-13", "scope=me");
        String cursor = JsonPath.read(first.getResponse().getContentAsString(), "$.data.nextCursor");
        assertThat(cursor).isNotBlank().doesNotContain(SNAPSHOT.toString());

        mockMvc.perform(auth(get(FOCUS).param("from", "2026-09-07").param("to", "2026-09-13").param("scope", "me")
                        .param("cursor", cursor)))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_FOCUS).get(1).query().split("&")).containsExactlyInAnyOrder(
                "from=2026-09-07", "to=2026-09-13", "scope=me", "snapshotId=" + SNAPSHOT, "offset=30");

        // 기간을 바꾸면 같은 커서를 받지 않는다
        mockMvc.perform(auth(get(FOCUS).param("from", "2026-09-01").param("to", "2026-09-13").param("scope", "me")
                        .param("cursor", cursor)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
    }

    @Test
    @DisplayName("집중 scope=island — 주민 집계만 내리고 개인 기록이 없으며 커서를 발급하지도 받지도 않는다")
    void focusIslandHasMembersOnly() throws Exception {
        DATA.on(DATA_FOCUS, request -> ok(FOCUS_ISLAND));

        mockMvc.perform(auth(get(FOCUS).param("from", "2026-09-07").param("to", "2026-09-13").param("scope", "island")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.members[0].totalSeconds").value(60))
                .andExpect(jsonPath("$.data.members[0].catColor").value(nullValue()))
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.data.records").doesNotExist())
                .andExpect(jsonPath("$.data.totalSeconds").doesNotExist());

        mockMvc.perform(auth(get(FOCUS).param("from", "2026-09-07").param("to", "2026-09-13").param("scope", "island")
                        .param("cursor", "x")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
    }

    @ParameterizedTest
    @CsvSource({"from=2026-9-1&to=2026-09-13&scope=me,400,INVALID_PARAMETER,from",
            "from=2026-02-30&to=2026-03-01&scope=me,422,OUT_OF_RANGE,from",
            "from=2026-09-13&to=2026-09-07&scope=me,422,OUT_OF_RANGE,from",
            "from=2026-09-01&to=2026-10-02&scope=me,422,OUT_OF_RANGE,to",
            "from=2026-09-01&to=2026-10-01&scope=all,422,OUT_OF_RANGE,scope",
            "from=2026-09-01&to=2026-09-07,400,INVALID_PARAMETER,scope",
            "from=2026-09-01&to=2026-09-07&scope=me&timezone=Asia/Seoul,400,INVALID_PARAMETER,timezone",
            "from=2026-09-01&to=2026-09-07&scope=me&limit=10,400,INVALID_PARAMETER,limit",
            "from=2026-09-01&from=2026-09-02&to=2026-09-07&scope=me,400,INVALID_PARAMETER,from"})
    @DisplayName("query 모양·범위 — 형식은 400, 없는 날짜·31일 초과·모르는 scope 는 422, UTC 외 timezone 은 400. 상류 호출 없음")
    void rejectsQueries(String query, int status, String code, String field) throws Exception {
        MockHttpServletRequestBuilder request = get(SCREEN + "?" + query);
        mockMvc.perform(auth(request))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value(field));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("31일(양끝 포함)과 timezone=UTC 는 받는다")
    void acceptsThirtyOneDaysAndUtc() throws Exception {
        DATA.on(DATA_SCREEN, request -> ok(SCREEN_ME));

        mockMvc.perform(auth(get(SCREEN).param("from", "2026-09-01").param("to", "2026-10-01").param("scope", "me")
                        .param("timezone", "UTC")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.measurementStatus").value("unavailable"))
                .andExpect(jsonPath("$.data.totalMinutes").value(nullValue()))
                .andExpect(jsonPath("$.data.updatedAt").value(nullValue()))
                .andExpect(jsonPath("$.data.members").doesNotExist());
    }

    @Test
    @DisplayName("스크린타임 scope=island — 주민별 상태만, 기기 정보 없음")
    void screenIslandMembers() throws Exception {
        DATA.on(DATA_SCREEN, request -> ok(SCREEN_ISLAND));

        mockMvc.perform(auth(get(SCREEN).param("from", "2026-09-07").param("to", "2026-09-13").param("scope", "island")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.members[0].measurementStatus").value("denied"))
                .andExpect(jsonPath("$.data.members[0].minutes").value(nullValue()))
                .andExpect(jsonPath("$.data.members[0].deviceId").doesNotExist())
                .andExpect(jsonPath("$.data.measurementStatus").doesNotExist());
    }

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "403,LIBRARY_LOCKED,403,FACILITY_LOCKED,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "409,STATISTICS_SNAPSHOT_EXPIRED,409,CURSOR_EXPIRED,cursor",
            "409,LIBRARY_LOCKED,502,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("조회 — 정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 502 다")
    void focusMapsDomainFailures(int upstreamStatus, String code, int publicStatus, String publicCode, String field)
            throws Exception {
        DATA.on(DATA_FOCUS, request -> error(upstreamStatus, code));

        mockMvc.perform(auth(get(FOCUS).param("from", "2026-09-07").param("to", "2026-09-13").param("scope", "me")))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field));
    }

    // ---------------------------------------------------------------- 공동 가계부 (GROMO-1786)

    @Test
    @DisplayName("가계부 — 월 합계와 최신순 줄을 내리고, limit 은 서버가 정하며 커서는 원장 행 id 를 드러내지 않는다")
    void ledgerPagesWithSignedCursor() throws Exception {
        DATA.on(DATA_LEDGER, request -> ok(LEDGER));

        MvcResult first = mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.month").value("2026-09"))
                .andExpect(jsonPath("$.data.earnedTotal").value(4800))
                .andExpect(jsonPath("$.data.spentTotal").value(1360))
                .andExpect(jsonPath("$.data.items[0].direction").value("spend"))
                .andExpect(jsonPath("$.data.items[0].reason").value("construction_debit"))
                .andExpect(jsonPath("$.data.items[0].amount").value(1360))
                .andExpect(jsonPath("$.data.items[0].entryCount").value(1))
                // 집중 적립은 하루로 접힌 줄이다(GROMO-1990) — groupedUntil 과 entryCount 가 그 사실을 말한다.
                .andExpect(jsonPath("$.data.items[1].reason").value("contribution"))
                .andExpect(jsonPath("$.data.items[1].groupedUntil").value("2026-09-11T14:00:00Z"))
                .andExpect(jsonPath("$.data.items[1].entryCount").value(480))
                // 타인 PII 를 원장 줄에 복사하지 않는다 — 주민별 기여는 도서관 게이트 뒤의 fish-earnings 몫이다.
                .andExpect(jsonPath("$.data.items[0].userId").doesNotExist())
                .andExpect(jsonPath("$.data.items[0].name").doesNotExist())
                .andReturn();
        assertThat(DATA.receivedFor(DATA_LEDGER).get(0).query().split("&"))
                .containsExactlyInAnyOrder("month=2026-09", "limit=30");

        String cursor = JsonPath.read(first.getResponse().getContentAsString(), "$.data.nextCursor");
        assertThat(cursor).isNotBlank().doesNotContain(ENTRY.toString());

        mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09").param("cursor", cursor)))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_LEDGER).get(1).query().split("&")).containsExactlyInAnyOrder(
                "month=2026-09", "limit=30", "afterCreatedAt=2026-09-11T00:00:00Z", "afterEntryId=" + ENTRY);

        // 달·방향을 바꾸면 같은 커서를 받지 않는다 — 필터가 바뀌면 keyset 축의 의미도 바뀐다.
        mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-08").param("cursor", cursor)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09").param("direction", "earn")
                        .param("cursor", cursor)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
    }

    @Test
    @DisplayName("가계부 — 마지막 쪽은 nextCursor 가 null 이고 방향 필터는 상류로 그대로 나간다")
    void ledgerLastPageHasNoCursor() throws Exception {
        DATA.on(DATA_LEDGER, request -> ok(LEDGER_LAST));

        mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09").param("direction", "spend")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.data.items").isEmpty());
        assertThat(DATA.receivedFor(DATA_LEDGER).get(0).query()).contains("direction=spend");
    }

    @ParameterizedTest
    @CsvSource({"month=2026-9,400,INVALID_PARAMETER,month",
            "month=2026-13,422,OUT_OF_RANGE,month",
            ",400,INVALID_PARAMETER,month",
            "month=2026-09&direction=all,422,OUT_OF_RANGE,direction",
            "month=2026-09&limit=10,400,INVALID_PARAMETER,limit",
            "month=2026-09&timezone=UTC,400,INVALID_PARAMETER,timezone",
            "month=2026-09&month=2026-08,400,INVALID_PARAMETER,month"})
    @DisplayName("가계부 query 모양 — 형식은 400, 없는 달·모르는 방향은 422. limit 은 공개 입력이 아니다. 상류 호출 없음")
    void ledgerRejectsQueries(String query, int status, String code, String field) throws Exception {
        mockMvc.perform(auth(get(LEDGER_PATH + (query == null ? "" : "?" + query))))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value(field));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("방문자(비주민)의 가계부 조회는 403 이고 빈 장부가 아니다 — 정책 「방문자에게 공동 가계부를 보여 주지 않는다」")
    void ledgerRejectsVisitor() throws Exception {
        DATA.on(DATA_LEDGER, request -> error(403, "MEMBER_ONLY"));

        String body = mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.field").value("islandId"))
                .andExpect(jsonPath("$.data").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        // 「거래가 없다」로 읽히는 값이 한 조각도 섞이지 않는다.
        assertThat(body).doesNotContain("items", "earnedTotal", "spentTotal", "month");
    }

    @ParameterizedTest
    @CsvSource({"500,INTERNAL_ERROR,500,INTERNAL_ERROR",
            "503,SERVICE_UNAVAILABLE,503,SERVICE_UNAVAILABLE",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND",
            "502,UPSTREAM_CONTRACT_ERROR,502,UPSTREAM_CONTRACT_ERROR"})
    @DisplayName("내부 조회 실패는 빈 장부로 접지 않는다 — 실패는 실패로 올라간다")
    void ledgerNeverFakesAnEmptyBook(int upstreamStatus, String code, int publicStatus, String publicCode)
            throws Exception {
        DATA.on(DATA_LEDGER, request -> error(upstreamStatus, code));

        String body = mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09")))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.data").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("earnedTotal", "spentTotal");
    }

    @Test
    @DisplayName("상류가 다른 달을 주거나 경계가 반쪽이면 502 — 조용히 그 달의 장부인 척하지 않는다")
    void ledgerRejectsMismatchedUpstream() throws Exception {
        DATA.on(DATA_LEDGER, request -> ok(LEDGER.replace("\"month\":\"2026-09\"", "\"month\":\"2026-08\"")));
        mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));

        // 다음 쪽 경계가 반쪽이면 커서를 만들 수 없다.
        DATA.on(DATA_LEDGER, request -> ok(LEDGER.replace("\"nextEntryId\":\"" + ENTRY + "\"",
                "\"nextEntryId\":null")));
        mockMvc.perform(auth(get(LEDGER_PATH).param("month", "2026-09")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 물고기 장 (GROMO-2046)

    @Test
    @DisplayName("물고기 장 — Data 명단을 순서 그대로 싣고 query 를 상류로 보내지 않는다(기간 축이 없다)")
    void fishEarningsCarriesMembersWithoutQuery() throws Exception {
        DATA.on(DATA_FISH, request -> ok(FISH));

        mockMvc.perform(auth(get(FISH_PATH)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.members[0].userId").value(USER.toString()))
                .andExpect(jsonPath("$.data.members[0].name").value("수빈"))
                .andExpect(jsonPath("$.data.members[0].earnedFish").value(4800))
                // 기록이 없는 주민도 0 으로 실린다 — 명단에서 빠지지 않는다.
                .andExpect(jsonPath("$.data.members[1].earnedFish").value(0))
                // 잔액·페이지 축이 아니다 — 재화는 섬 단위 하나이고 개인 지갑이 없다(GROMO-1989).
                .andExpect(jsonPath("$.data.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.data.balance").doesNotExist());
        assertThat(DATA.receivedFor(DATA_FISH).get(0).query()).isNullOrEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"from=2026-09-01&to=2026-09-07", "scope=island", "cursor=x", "limit=10"})
    @DisplayName("물고기 장 — query 는 하나도 받지 않는다(400). 모르는 키를 조용히 버리지 않는다. 상류 호출 없음")
    void fishEarningsRejectsAnyQuery(String query) throws Exception {
        mockMvc.perform(auth(get(FISH_PATH + "?" + query)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"403,LIBRARY_LOCKED,403,FACILITY_LOCKED,",
            "403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,LIBRARY_LOCKED,502,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("물고기 장 — 도서관 게이트·비주민은 «공개 오류 표»를 거친다(502 로 새지 않는다)")
    void fishEarningsMapsDomainFailures(int upstreamStatus, String code, int publicStatus, String publicCode,
            String field) throws Exception {
        DATA.on(DATA_FISH, request -> error(upstreamStatus, code));

        String body = mockMvc.perform(auth(get(FISH_PATH)))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field))
                .andExpect(jsonPath("$.data").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        // 방문자·미완공에 「아무도 안 낚았다」로 읽히는 빈 명단을 내주지 않는다.
        assertThat(body).doesNotContain("members", "earnedFish");
    }

    @Test
    @DisplayName("물고기 장 — 명단이 없거나 마리 수가 빠지면 502 다. 빠진 값을 0 으로 지어내지 않는다")
    void fishEarningsRejectsIncompleteUpstream() throws Exception {
        DATA.on(DATA_FISH, request -> ok("{\"members\":null}"));
        mockMvc.perform(auth(get(FISH_PATH)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));

        DATA.on(DATA_FISH, request -> ok("{\"members\":[{\"userId\":\"" + USER + "\",\"name\":\"수빈\"}]}"));
        mockMvc.perform(auth(get(FISH_PATH)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 측정 PUT

    @Test
    @DisplayName("PUT — 세션·세대·키를 옮기고 timezone 을 UTC 로 정규화한 본문만 보낸다")
    void putForwardsNormalizedBody() throws Exception {
        DATA.on(DATA_PUT, request -> ok("{\"date\":\"2026-09-11\",\"minutes\":90,\"measurementStatus\":\"authorized\"}"));

        mockMvc.perform(write(put(UPLOAD), UPLOAD_BODY.replace(",\"timezone\":\"UTC\"", "")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.date").value("2026-09-11"))
                .andExpect(jsonPath("$.data.minutes").value(90))
                .andExpect(jsonPath("$.data.measurementStatus").value("authorized"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_PUT).get(0);
        assertThat(forwarded.header("X-Session-Id")).isEqualTo(SESSION.toString());
        assertThat(forwarded.header("X-Auth-Generation")).isEqualTo("3");
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.body()).isEqualTo(UPLOAD_BODY);
    }

    @Test
    @DisplayName("PUT — 측정 없음 상태는 minutes 명시 null 로 받는다")
    void putAcceptsNullMinutesForUnmeasured() throws Exception {
        DATA.on(DATA_PUT, request -> ok("{\"date\":\"2026-09-11\",\"minutes\":null,\"measurementStatus\":\"denied\"}"));

        mockMvc.perform(write(put(UPLOAD), "{\"minutes\":null,\"measurementStatus\":\"denied\","
                        + "\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"" + SESSION + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.minutes").value(nullValue()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]",
            "{\"minutes\":\"90\",\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}",
            "{\"minutes\":1.5,\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}",
            "{\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}",
            "{\"minutes\":0,\"measurementStatus\":\"denied\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}",
            "{\"minutes\":90,\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11\",\"deviceId\":\"%s\"}",
            "{\"minutes\":90,\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"fcm-token\"}",
            "{\"minutes\":90,\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\","
                    + "\"achieved\":true}"})
    @DisplayName("PUT — 모양이 틀린 본문(문자열·소수·누락·상태와 안 맞는 minutes·날짜만 시각·FCM 토큰·보상 필드)은 400")
    void putRejectsMalformedBodies(String body) throws Exception {
        mockMvc.perform(write(put(UPLOAD), body.replace("%s", SESSION.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/me/screen-time/2026-09-11|{\"minutes\":-1,\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}|422|OUT_OF_RANGE|minutes",
            "/me/screen-time/2026-09-11|{\"minutes\":null,\"measurementStatus\":\"blocked\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}|422|OUT_OF_RANGE|measurementStatus",
            "/me/screen-time/2026-09-11|{\"minutes\":1,\"measurementStatus\":\"authorized\",\"timezone\":\"Asia/Seoul\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}|400|INVALID_PARAMETER|timezone",
            "/me/screen-time/2026-09-11|{\"minutes\":1,\"measurementStatus\":\"authorized\",\"timezone\":null,\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}|400|INVALID_PARAMETER|timezone",
            "/me/screen-time/2026-02-30|{\"minutes\":1,\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}|422|OUT_OF_RANGE|date",
            "/me/screen-time/20260911|{\"minutes\":1,\"measurementStatus\":\"authorized\",\"measuredAt\":\"2026-09-11T09:10:00Z\",\"deviceId\":\"%s\"}|400|INVALID_PARAMETER|date"})
    @DisplayName("PUT — 범위·값 위반은 422, timezone·경로 날짜 형식은 400. 상류 호출 없음")
    void putRejectsOutOfRange(String path, String body, int status, String code, String field) throws Exception {
        mockMvc.perform(write(put(path), body.replace("%s", SESSION.toString())))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value(field));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("PUT — Idempotency-Key 없으면 400, 상류 호출 없음")
    void putRequiresKey() throws Exception {
        mockMvc.perform(auth(put(UPLOAD)).contentType(MediaType.APPLICATION_JSON).content(UPLOAD_BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"403,SESSION_NOT_ACTIVE,401,UNAUTHORIZED,",
            "403,SCREEN_TIME_DEVICE_FORBIDDEN,403,FORBIDDEN,deviceId",
            "409,SCREEN_TIME_MEASUREMENT_CONFLICT,409,STATE_CONFLICT,measuredAt",
            "422,SCREEN_TIME_OUT_OF_WINDOW,422,OUT_OF_RANGE,measuredAt",
            "422,SCREEN_TIME_INVALID_MEASUREMENT,422,OUT_OF_RANGE,measurementStatus",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "400,UNKNOWN,502,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("PUT — 도메인 실패의 공개 오류 표")
    void putMapsDomainFailures(int upstreamStatus, String code, int publicStatus, String publicCode, String field)
            throws Exception {
        DATA.on(DATA_PUT, request -> error(upstreamStatus, code));

        mockMvc.perform(write(put(UPLOAD), UPLOAD_BODY))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field));
    }

    @Test
    @DisplayName("PUT — authorized 인데 minutes 가 없는 응답은 계약 불일치 502")
    void putResponseShapeIsChecked() throws Exception {
        DATA.on(DATA_PUT, request -> ok("{\"date\":\"2026-09-11\",\"minutes\":null,\"measurementStatus\":\"authorized\"}"));

        mockMvc.perform(write(put(UPLOAD), UPLOAD_BODY))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 도구

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
