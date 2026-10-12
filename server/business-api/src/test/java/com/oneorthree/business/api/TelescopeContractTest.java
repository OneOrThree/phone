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
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 망원경 목록 공개 계약 (GROMO-2265) — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다.
 *
 * <p>조립 규칙(칸·시드·항해 분·정원 찬 섬 채우기·게이트 없음)은 data-api 의 {@code TelescopeIntegrationTest} 가 본다.
 * 여기서 보는 것은 주체 전달, 공개 모양(필드 그대로·상류 내부 필드 차단·null 평균 유지), 상류 실패의 공개 오류 표다.
 */
class TelescopeContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-2265-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-2265-0000-0000-000000000001");
    private static final UUID HOME = UUID.fromString("cccccccc-2265-0000-0000-000000000001");
    private static final UUID NEARBY = UUID.fromString("dddddddd-2265-0000-0000-000000000001");

    private static final String DATA_TELESCOPE = "GET /internal/users/" + USER + "/telescope";
    private static final String TELESCOPE = "/me/telescope";

    private static final String LIST = "{\"bucketStart\":\"2026-10-12T05:00:00Z\",\"nextRefreshMinutes\":37,"
            + "\"items\":[{\"islandId\":\"" + HOME + "\",\"name\":\"윤슬\",\"intro\":\"같이 집중해요\","
            + "\"memberCount\":2,\"maxMembers\":5,\"approvalRequired\":false,\"membershipStatus\":\"active\","
            + "\"slot\":\"joined\",\"sailingMinutes\":60,\"averageFocusMinutesPerDay\":83,\"full\":false,"
            + "\"arrivedBefore\":true},"
            + "{\"islandId\":\"" + NEARBY + "\",\"name\":\"물결\",\"intro\":\"\",\"memberCount\":1,"
            + "\"maxMembers\":10,\"approvalRequired\":true,\"membershipStatus\":\"pending\",\"slot\":\"nearby\","
            + "\"sailingMinutes\":15,\"averageFocusMinutesPerDay\":null,\"full\":false,\"arrivedBefore\":false}]}";

    @Test
    @DisplayName("상류 목록을 공개 필드 그대로 내리고 상류 내부 필드는 버린다 — 주체는 서명된 세션에서만 온다")
    void mirrorsTheUpstreamListForTheSignedSubject() throws Exception {
        String decorated = LIST.replace("{\"islandId\"", "{\"rowId\":\"private\",\"islandId\"");
        DATA.on(DATA_TELESCOPE, request -> ok(decorated));

        var result = mockMvc.perform(auth(get(TELESCOPE)).header("X-User-Id", NEARBY))
                .andExpect(status().isOk())
                .andReturn();

        ObjectMapper json = new ObjectMapper();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data"))
                .isEqualTo(json.readTree(LIST));
        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_TELESCOPE).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.query()).isNullOrEmpty();
    }

    @Test
    @DisplayName("빈 목록은 그대로 통과하고, 칸에 필수 키가 빠진 상류 응답은 계약 오류다")
    void emptyListPassesButAMissingSlotIsAContractError() throws Exception {
        DATA.on(DATA_TELESCOPE, request -> ok(
                "{\"bucketStart\":\"2026-10-12T05:00:00Z\",\"nextRefreshMinutes\":1,\"items\":[]}"));
        mockMvc.perform(auth(get(TELESCOPE)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nextRefreshMinutes").value(1))
                .andExpect(jsonPath("$.data.items").isEmpty());

        DATA.reset();
        DATA.on(DATA_TELESCOPE, request -> ok(LIST.replace("\"slot\":\"nearby\",", "")));
        mockMvc.perform(auth(get(TELESCOPE)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    /**
     * 상류 DTO 규약 — 필수 키는 {@code @JsonProperty(required = true)}, null 금지는 {@code @JsonSetter(nulls = FAIL)},
     * 목록 원소 null 금지는 {@code contentNulls = FAIL} 이다. 어기면 {@code InternalHttpClient} 가 변환 실패를 계약 불일치로
     * 올리고, 내부 502 {@code UPSTREAM_CONTRACT_ERROR} 는 공개 경로에서 {@code ApiResponses.transportStatus} 가 400 으로
     * 내보낸다. 평균은 «키 필수·값 null 허용»(MyIslands.currentIslandId 와 같은 모양)이라 null 은 통과하고(위 첫 테스트)
     * 키 누락만 계약 오류다.
     */
    @ParameterizedTest
    @ValueSource(strings = {"items 누락", "items:[null]", "bucketStart 누락", "bucketStart:null",
        "averageFocusMinutesPerDay 누락"})
    @DisplayName("상류 응답의 필수 키 누락·null·null 칸은 공개 목록 대신 계약 오류다")
    void malformedUpstreamListsAreContractErrors(String shape) throws Exception {
        String body = switch (shape) {
            case "items 누락" -> "{\"bucketStart\":\"2026-10-12T05:00:00Z\",\"nextRefreshMinutes\":37}";
            case "items:[null]" ->
                    "{\"bucketStart\":\"2026-10-12T05:00:00Z\",\"nextRefreshMinutes\":37,\"items\":[null]}";
            case "bucketStart 누락" -> "{\"nextRefreshMinutes\":37,\"items\":[]}";
            case "bucketStart:null" -> "{\"bucketStart\":null,\"nextRefreshMinutes\":37,\"items\":[]}";
            case "averageFocusMinutesPerDay 누락" -> LIST.replace("\"averageFocusMinutesPerDay\":null,", "");
            default -> throw new IllegalArgumentException(shape);
        };
        assertThat(body).isNotEqualTo(LIST);
        DATA.on(DATA_TELESCOPE, request -> ok(body));

        mockMvc.perform(auth(get(TELESCOPE)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @ParameterizedTest
    @CsvSource({"404,USER_NOT_FOUND,404,USER_NOT_FOUND", "409,USER_NOT_FOUND,400,UPSTREAM_CONTRACT_ERROR",
        "400,UNKNOWN_TELESCOPE_ERROR,400,UPSTREAM_CONTRACT_ERROR"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 계약 오류다")
    void mapsDomainFailures(int upstreamStatus, String upstreamCode, int publicStatus, String publicCode)
            throws Exception {
        DATA.on(DATA_TELESCOPE, request -> new MockUpstream.Response(upstreamStatus,
                "{\"code\":\"" + upstreamCode + "\",\"message\":\"private detail\"}"));

        mockMvc.perform(auth(get(TELESCOPE)))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode));
    }

    // ---------------------------------------------------------------- 도구

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
