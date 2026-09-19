package com.oneorthree.business.api;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 공용 음악(방송기) 공개 2종의 계약 (GROMO-1779) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 *
 * <p>주민·방송기·소유·버전·전이의 원자 판정은 data-api 통합 테스트가 본다. 여기서 보는 것은 경계다:
 * 주체, 본문 → fields/values 캐리어, 상류 실패의 공개 오류 매핑, 버전 충돌의 current, 잘못된 상류 DTO 의 502.
 */
class PlaybackContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1779-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1779-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1779-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("dddddddd-1779-0000-0000-000000000001");
    private static final String KEY = "eeeeeeee-1779-5000-8000-000000000001";

    private static final String DATA_GET = "GET /internal/islands/" + ISLAND + "/playback";
    private static final String DATA_PATCH = "PATCH /internal/islands/" + ISLAND + "/playback";

    private static final String INITIAL = "{\"trackId\":null,\"playing\":false,\"positionSeconds\":0,"
            + "\"effectiveAt\":\"2026-09-11T09:10:00Z\",\"changedBy\":null,\"version\":0,"
            + "\"serverNow\":\"2026-09-11T09:10:01Z\",\"durationSeconds\":null}";
    private static final String PLAYING = "{\"trackId\":\"campfire\",\"playing\":true,\"positionSeconds\":12,"
            + "\"effectiveAt\":\"2026-09-11T09:10:00Z\",\"changedBy\":\"" + USER + "\",\"version\":3,"
            + "\"serverNow\":\"2026-09-11T09:10:00Z\",\"durationSeconds\":120.5}";
    private static final String PATCH_RESULT = "{\"data\":" + PLAYING + ",\"events\":[]}";

    // ---------------------------------------------------------------- 정상 경로

    @Test
    @DisplayName("초기 GET 은 nullable 필드를 생략하지 않고 null 로 내린다 (정책 M08)")
    void initialGetKeepsNulls() throws Exception {
        DATA.on(DATA_GET, request -> ok(INITIAL));

        MvcResult result = mockMvc.perform(auth(get("/islands/" + ISLAND + "/playback")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.playing").value(false))
                .andExpect(jsonPath("$.data.positionSeconds").value(0))
                .andExpect(jsonPath("$.data.version").value(0))
                .andReturn();
        String body = result.getResponse().getContentAsString();
        assertThat(body).contains("\"trackId\":null").contains("\"changedBy\":null")
                .contains("\"durationSeconds\":null");
        assertThat(DATA.receivedFor(DATA_GET).get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("PATCH 는 제출 필드만 캐리어로 옮기고 data 만 공개로 내린다 — 주체는 서명 세션뿐")
    void patchCarriesSubmittedFieldsAndUnwrapsData() throws Exception {
        DATA.on(DATA_PATCH, request -> ok(PATCH_RESULT));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/playback"),
                        "{\"trackId\":\"campfire\",\"playing\":true,\"expectedVersion\":2}")
                        .header("X-User-Id", OTHER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.trackId").value("campfire"))
                .andExpect(jsonPath("$.data.version").value(3))
                .andExpect(jsonPath("$.data.durationSeconds").value(120.5))
                .andExpect(jsonPath("$.data.changedBy").value(USER.toString()))
                .andExpect(jsonPath("$.data.events").doesNotExist());

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_PATCH).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.body()).contains("\"fields\":[\"trackId\",\"playing\"]")
                .contains("\"values\":{\"trackId\":\"campfire\",\"playing\":true}")
                .contains("\"expectedVersion\":2");
    }

    // ---------------------------------------------------------------- 버전 충돌

    @Test
    @DisplayName("expectedVersion 불일치는 409+current(최신 공개 재생 상태)이고 field 는 expectedVersion")
    void versionConflictCarriesCurrent() throws Exception {
        DATA.on(DATA_PATCH, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_GET, request -> ok(PLAYING));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/playback"),
                        "{\"playing\":false,\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("expectedVersion"))
                .andExpect(jsonPath("$.current.version").value(3))
                .andExpect(jsonPath("$.current.resource.trackId").value("campfire"));
    }

    @Test
    @DisplayName("current 재조회가 실패하면 충돌은 current 없이 나간다")
    void failedRefetchDropsCurrent() throws Exception {
        DATA.on(DATA_PATCH, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_GET, request -> error(403, "MEMBER_ONLY"));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/playback"),
                        "{\"playing\":false,\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.current").doesNotExist());
    }

    // ---------------------------------------------------------------- 오류 표

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "403,FACILITY_LOCKED,403,FACILITY_LOCKED,",
            "403,FORBIDDEN,403,FORBIDDEN,trackId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "400,INVALID_REQUEST,400,INVALID_REQUEST,",
            "422,OUT_OF_RANGE,422,OUT_OF_RANGE,",
            "409,STATE_CONFLICT,409,STATE_CONFLICT,playing",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "403,OUT_OF_RANGE,502,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_PLAYBACK_ERROR,502,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 502 다")
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_PATCH, request -> error(upstreamStatus, code));

        MvcResult result = mockMvc.perform(write(patch("/islands/" + ISLAND + "/playback"),
                        "{\"playing\":true,\"expectedVersion\":0}"))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
    }

    @Test
    @DisplayName("GET 도 같은 매핑이다 — 방송기 미완공 403 FACILITY_LOCKED")
    void getMapsFacilityLocked() throws Exception {
        DATA.on(DATA_GET, request -> error(403, "FACILITY_LOCKED"));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/playback")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            // 곡이 있는데 길이가 없다 — 임의 길이 60 을 채우지 않는다
            "{\"trackId\":\"campfire\",\"playing\":true,\"positionSeconds\":0,\"effectiveAt\":\"2026-09-11T09:10:00Z\","
                    + "\"changedBy\":\"aaaaaaaa-1779-0000-0000-000000000001\",\"version\":1,"
                    + "\"serverNow\":\"2026-09-11T09:10:00Z\",\"durationSeconds\":null}",
            // 길이 0
            "{\"trackId\":\"campfire\",\"playing\":true,\"positionSeconds\":0,\"effectiveAt\":\"2026-09-11T09:10:00Z\","
                    + "\"changedBy\":\"aaaaaaaa-1779-0000-0000-000000000001\",\"version\":1,"
                    + "\"serverNow\":\"2026-09-11T09:10:00Z\",\"durationSeconds\":0}",
            // 곡 없이 재생 중
            "{\"trackId\":null,\"playing\":true,\"positionSeconds\":0,\"effectiveAt\":\"2026-09-11T09:10:00Z\","
                    + "\"changedBy\":null,\"version\":0,\"serverNow\":\"2026-09-11T09:10:00Z\",\"durationSeconds\":null}",
            // 필드 누락
            "{\"trackId\":null,\"playing\":false}"})
    @DisplayName("상류 DTO 불변식이 깨지면 502 UPSTREAM_CONTRACT_ERROR 로 fail closed")
    void malformedUpstreamFailsClosed(String upstream) throws Exception {
        DATA.on(DATA_GET, request -> ok(upstream));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/playback")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 입력 거절

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]",
            "{\"expectedVersion\":1}",
            "{\"trackId\":null,\"expectedVersion\":1}",
            "{\"playing\":null,\"expectedVersion\":1}",
            "{\"trackId\":1,\"expectedVersion\":1}",
            "{\"playing\":\"true\",\"expectedVersion\":1}",
            "{\"playing\":true}",
            "{\"playing\":true,\"expectedVersion\":1.5}",
            "{\"playing\":true,\"expectedVersion\":1,\"volume\":3}",
            "{\"playing\":true,\"expectedVersion\":1,\"positionSeconds\":3}"})
    @DisplayName("PATCH 는 trackId·playing 중 하나 이상(명시 null 불가)과 정수 expectedVersion 을 요구한다")
    void rejectsMalformedBodyBeforeTheNetwork(String body) throws Exception {
        DATA.on(DATA_PATCH, request -> ok(PATCH_RESULT));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/playback"), body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("음수 expectedVersion 은 422, 키 없는 PATCH 는 400, 세션 없으면 401 — 상류를 부르지 않는다")
    void guardsBeforeTheNetwork() throws Exception {
        DATA.on(DATA_PATCH, request -> ok(PATCH_RESULT));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/playback"), "{\"playing\":true,\"expectedVersion\":-1}"))
                .andExpect(status().isUnprocessableEntity());
        mockMvc.perform(auth(patch("/islands/" + ISLAND + "/playback"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"playing\":true,\"expectedVersion\":1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(get("/islands/" + ISLAND + "/playback").header("X-User-Id", USER))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(auth(get("/islands/not-a-uuid/playback")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("islandId"));
        assertThat(DATA.received()).isEmpty();
    }

    // ---------------------------------------------------------------- 도구

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).header("Idempotency-Key", KEY)
                .contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status,
                "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
