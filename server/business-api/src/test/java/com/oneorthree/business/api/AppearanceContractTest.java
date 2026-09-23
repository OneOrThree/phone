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
 * 보유품·외양 공개 4종의 계약 (GROMO-1783) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 *
 * <p>소유권·kind·권한·버전의 원자 판정은 data-api 쪽 통합 테스트가 본다. 여기서 보는 것은
 * 경계다: 주체를 무엇으로 정하는가, tri-state 본문을 fields/values 캐리어로 어떻게 옮기는가,
 * 어떤 상류 실패만 공개 오류로 옮기는가, 버전 충돌의 current 를 어떻게 채우는가.
 */
class AppearanceContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1783-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1783-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1783-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("dddddddd-1783-0000-0000-000000000001");
    private static final String KEY = "eeeeeeee-1783-5000-8000-000000000001";

    private static final String DATA_MY_INV = "GET /internal/users/" + USER + "/inventory";
    private static final String DATA_MY_APP = "PATCH /internal/users/" + USER + "/appearance";
    private static final String DATA_ISLAND_INV = "GET /internal/islands/" + ISLAND + "/inventory";
    private static final String DATA_ISLAND_APP = "PATCH /internal/islands/" + ISLAND + "/appearance";

    private static final String MY_INV_BODY = "{\"clothes\":[\"jacket\"],\"decor\":[],"
            + "\"hulls\":[\"raft\"],\"inventoryVersion\":3,"
            + "\"equipped\":{\"clothes\":\"jacket\",\"decor\":null,\"hull\":\"raft\","
            + "\"position\":\"front\",\"version\":2}}";
    private static final String ISLAND_INV_BODY = "{\"audio\":[\"waves\"],\"islandThemes\":[\"pine\"],"
            + "\"buildingThemes\":[{\"buildingId\":\"hall\",\"themeId\":\"hall_theme\"}],"
            + "\"inventoryVersion\":1,"
            + "\"appearance\":{\"islandThemeId\":\"pine\",\"buildingThemes\":{\"hall\":\"default\"},"
            + "\"version\":5}}";
    private static final String MY_APP_RESULT = "{\"data\":{\"clothes\":\"jacket\",\"decor\":null,"
            + "\"hull\":\"raft\",\"position\":\"front\",\"version\":2},"
            + "\"events\":[{\"eventId\":\"e1\",\"type\":\"member.appearance.updated\"}]}";
    private static final String ISLAND_APP_RESULT = "{\"data\":{\"islandThemeId\":\"pine\","
            + "\"buildingThemes\":{\"hall\":\"default\"},\"version\":6},"
            + "\"events\":[{\"eventId\":\"e2\",\"type\":\"island.appearance.updated\"}]}";

    // ---------------------------------------------------------------- 주체

    @Test
    @DisplayName("주체는 서명된 세션에서만 오고 공격자가 넣은 X-User-Id·X-Service-Token 은 버려진다")
    void forwardsOnlyTheSignedSubjectAndNeverTheAttackerHeaders() throws Exception {
        DATA.on(DATA_MY_APP, request -> ok(MY_APP_RESULT));

        mockMvc.perform(write(patch("/me/appearance"), "{\"clothes\":\"jacket\"}")
                        .header("X-User-Id", OTHER)
                        .header("X-Service-Token", "stolen"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.clothes").value("jacket"))
                .andExpect(jsonPath("$.data.version").value(2));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_MY_APP).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Authorization")).isEqualTo("Bearer ci-token-data");
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.header("X-Service-Token")).isNull();
    }

    // ---------------------------------------------------------------- 정상 경로

    @Test
    @DisplayName("GET /me/inventory 는 목록·버전·equipped 를 그대로 벗겨 내린다")
    void myInventoryPassesThrough() throws Exception {
        DATA.on(DATA_MY_INV, request -> ok(MY_INV_BODY));

        mockMvc.perform(auth(get("/me/inventory")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.clothes[0]").value("jacket"))
                .andExpect(jsonPath("$.data.hulls[0]").value("raft"))
                .andExpect(jsonPath("$.data.inventoryVersion").value(3))
                .andExpect(jsonPath("$.data.equipped.version").value(2));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_MY_INV).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("개인 PATCH 본문은 fields/values 캐리어로 옮기고 명시 null 을 지우지 않는다")
    void personalPatchCarriesTriStateFieldsAndValues() throws Exception {
        DATA.on(DATA_MY_APP, request -> ok(MY_APP_RESULT));

        mockMvc.perform(write(patch("/me/appearance"),
                        "{\"clothes\":\"jacket\",\"decor\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(2));

        String forwarded = DATA.receivedFor(DATA_MY_APP).get(0).body();
        assertThat(forwarded).contains("\"fields\":[\"clothes\",\"decor\"]");
        // 명시 null 은 「해제」 의미라 캐리어에 null 키로 남아야 한다 — 제거되면 다른 명령이 된다.
        assertThat(forwarded).contains("\"values\":{\"clothes\":\"jacket\",\"decor\":null}");
    }

    @Test
    @DisplayName("GET /islands/{id}/inventory 는 공동 목록과 appearance 를 함께 내린다")
    void islandInventoryPassesThrough() throws Exception {
        DATA.on(DATA_ISLAND_INV, request -> ok(ISLAND_INV_BODY));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/inventory")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.audio[0]").value("waves"))
                .andExpect(jsonPath("$.data.islandThemes[0]").value("pine"))
                .andExpect(jsonPath("$.data.buildingThemes[0].buildingId").value("hall"))
                .andExpect(jsonPath("$.data.inventoryVersion").value(1))
                .andExpect(jsonPath("$.data.appearance.version").value(5));
    }

    @Test
    @DisplayName("공동 PATCH 는 expectedVersion 을 캐리어에 싣고 data 만 공개로 내린다")
    void islandPatchCarriesExpectedVersionAndUnwrapsData() throws Exception {
        DATA.on(DATA_ISLAND_APP, request -> ok(ISLAND_APP_RESULT));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"islandThemeId\":\"pine\",\"expectedVersion\":5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.islandThemeId").value("pine"))
                .andExpect(jsonPath("$.data.version").value(6))
                // events 는 realtime relay 의 몫이라 공개 응답에 싣지 않는다.
                .andExpect(jsonPath("$.data.events").doesNotExist());

        String forwarded = DATA.receivedFor(DATA_ISLAND_APP).get(0).body();
        assertThat(forwarded).contains("\"fields\":[\"islandThemeId\"]");
        assertThat(forwarded).contains("\"expectedVersion\":5");
    }

    // ---------------------------------------------------------------- 버전 충돌의 current

    @Test
    @DisplayName("expectedVersion 불일치는 409+current 이며 field 는 expectedVersion 이다")
    void islandVersionConflictCarriesCurrentSnapshot() throws Exception {
        DATA.on(DATA_ISLAND_APP, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_ISLAND_INV, request -> ok(ISLAND_INV_BODY));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"islandThemeId\":\"pine\",\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("expectedVersion"))
                .andExpect(jsonPath("$.current.version").value(5))
                .andExpect(jsonPath("$.current.resource.islandThemeId").value("pine"));

        // current 재조회는 같은 세션 주체로 내부 GET 을 한 번 더 부른다.
        assertThat(DATA.receivedFor(DATA_ISLAND_INV)).hasSize(1);
        assertThat(DATA.receivedFor(DATA_ISLAND_INV).get(0).header("X-User-Id"))
                .isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("current 재조회마저 실패하면 충돌은 current 없이 나간다")
    void failedRefetchDropsCurrentButKeepsTheConflict() throws Exception {
        DATA.on(DATA_ISLAND_APP, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_ISLAND_INV, request -> error(403, "MEMBER_ONLY"));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"islandThemeId\":\"pine\",\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.current").doesNotExist());
    }

    // ---------------------------------------------------------------- 오류 표

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "403,NOT_OWNER,403,FORBIDDEN,islandId",
            "403,FORBIDDEN,403,FORBIDDEN,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "404,PRODUCT_NOT_FOUND,404,PRODUCT_NOT_FOUND,",
            "400,INVALID_REQUEST,400,INVALID_REQUEST,",
            "422,OUT_OF_RANGE,422,OUT_OF_RANGE,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,VERSION_CONFLICT_409_STATUS_MISMATCH,400,UPSTREAM_CONTRACT_ERROR,",
            "403,OUT_OF_RANGE,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_APPEARANCE_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 400 다")
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_ISLAND_APP, request -> error(upstreamStatus, code));

        MvcResult result = mockMvc.perform(write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"islandThemeId\":\"pine\",\"expectedVersion\":5}"))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString())
                .as("상류의 내부 문구가 공개 응답에 새지 않는다").doesNotContain("private detail");
    }

    // ---------------------------------------------------------------- 입력 거절

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "\"x\"",
            "{\"clothes\":1}",
            "{\"clothes\":\"jacket\",\"extra\":1}",
            "{\"hull\":[\"raft\"]}"})
    @DisplayName("개인 PATCH 본문 모양이 어긋나면 네트워크 전에 400 이다")
    void rejectsMalformedPersonalBodyBeforeTheNetwork(String body) throws Exception {
        DATA.on(DATA_MY_APP, request -> ok(MY_APP_RESULT));

        mockMvc.perform(write(patch("/me/appearance"), body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}",
            "{\"islandThemeId\":\"pine\"}",
            "{\"islandThemeId\":\"pine\",\"expectedVersion\":\"5\"}",
            "{\"islandThemeId\":\"pine\",\"expectedVersion\":5.5}",
            "{\"expectedVersion\":5}",
            "{\"buildingThemes\":\"hall\",\"expectedVersion\":5}",
            "{\"islandThemeId\":\"pine\",\"expectedVersion\":5,\"extra\":1}"})
    @DisplayName("공동 PATCH 는 외양 필드 1개 이상과 정수 expectedVersion 을 요구한다")
    void islandPatchRequiresFieldsAndIntegerVersion(String body) throws Exception {
        DATA.on(DATA_ISLAND_APP, request -> ok(ISLAND_APP_RESULT));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/appearance"), body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("buildingThemes 의 건물 값이 문자열·null 이 아니면 400 이다")
    void buildingThemeValuesMustBeStringOrNull() throws Exception {
        DATA.on(DATA_ISLAND_APP, request -> ok(ISLAND_APP_RESULT));

        mockMvc.perform(write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"buildingThemes\":{\"hall\":1},\"expectedVersion\":5}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"buildingThemes\":{\"hall\":[\"x\"]},\"expectedVersion\":5}"))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("쓰기는 UUID 멱등키 하나와 서명 세션을 요구한다")
    void writesRequireOneUuidKeyAndASignedSession() throws Exception {
        DATA.on(DATA_MY_APP, request -> ok(MY_APP_RESULT));
        String body = "{\"clothes\":\"jacket\"}";

        mockMvc.perform(auth(patch("/me/appearance"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(patch("/me/appearance")
                        .header("Idempotency-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/me/inventory").header("X-User-Id", USER))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("경로의 islandId 가 UUID 가 아니면 400 이고 상류를 부르지 않는다")
    void malformedIslandIdNeverReachesUpstream() throws Exception {
        DATA.on(DATA_ISLAND_INV, request -> ok(ISLAND_INV_BODY));

        mockMvc.perform(auth(get("/islands/not-a-uuid/inventory")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("islandId"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"personalInventory", "sharedInventory", "personalPatch", "islandPatch", "conflict"})
    void publicProjectionKeepsNestedFieldsAndSlotNulls(String operation) throws Exception {
        String expected;
        MockHttpServletRequestBuilder request;
        switch (operation) {
            case "personalInventory" -> {
                expected = MY_INV_BODY;
                DATA.on(DATA_MY_INV, call -> ok(MY_INV_BODY.replace("\"inventoryVersion\":3",
                        "\"inventoryVersion\":3,\"inventory_row_id\":7")
                        .replace("\"version\":2}", "\"version\":2,\"equipped_row_id\":8}")));
                request = auth(get("/me/inventory"));
            }
            case "sharedInventory" -> {
                expected = ISLAND_INV_BODY;
                DATA.on(DATA_ISLAND_INV, call -> ok(ISLAND_INV_BODY.replace("\"themeId\":\"hall_theme\"}",
                        "\"themeId\":\"hall_theme\",\"purchase_row_id\":7}")
                        .replace("\"version\":5}", "\"version\":5,\"appearance_row_id\":8}")));
                request = auth(get("/islands/" + ISLAND + "/inventory"));
            }
            case "personalPatch" -> {
                expected = "{\"clothes\":\"jacket\",\"decor\":null,\"hull\":\"raft\",\"position\":\"front\",\"version\":2}";
                DATA.on(DATA_MY_APP, call -> ok(MY_APP_RESULT.replace("\"version\":2}",
                        "\"version\":2,\"equipped_row_id\":8}")));
                request = write(patch("/me/appearance"), "{\"decor\":null}");
            }
            case "islandPatch" -> {
                expected = "{\"islandThemeId\":\"pine\",\"buildingThemes\":{\"hall\":\"default\"},\"version\":6}";
                DATA.on(DATA_ISLAND_APP, call -> ok(ISLAND_APP_RESULT.replace("\"version\":6}",
                        "\"version\":6,\"appearance_row_id\":8}")));
                request = write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"islandThemeId\":\"pine\",\"expectedVersion\":5}");
            }
            default -> {
                expected = "{\"islandThemeId\":\"pine\",\"buildingThemes\":{\"hall\":\"default\"},\"version\":5}";
                DATA.on(DATA_ISLAND_APP, call -> error(409, "VERSION_CONFLICT"));
                DATA.on(DATA_ISLAND_INV, call -> ok(ISLAND_INV_BODY.replace("\"version\":5}",
                        "\"version\":5,\"appearance_row_id\":8}")));
                request = write(patch("/islands/" + ISLAND + "/appearance"),
                        "{\"islandThemeId\":\"pine\",\"expectedVersion\":3}");
            }
        }
        var result = mockMvc.perform(request)
                .andExpect(status().is(operation.equals("conflict") ? 409 : 200)).andReturn();
        var json = new tools.jackson.databind.ObjectMapper();
        var response = json.readTree(result.getResponse().getContentAsString());
        var actual = operation.equals("conflict") ? response.path("current").path("resource") : response.path("data");
        assertThat(actual).isEqualTo(json.readTree(expected));
        assertThat(result.getResponse().getContentAsString()).doesNotContain("eventId", "row_id");
    }

    // ---------------------------------------------------------------- 도구

    @ParameterizedTest
    @CsvSource({"/me/inventory,get,,clothes decor hulls inventoryVersion equipped",
            "/me/inventory,get,equipped,clothes decor hull position version",
            "/islands/{islandId}/inventory,get,,audio islandThemes buildingThemes inventoryVersion appearance",
            "/islands/{islandId}/inventory,get,appearance,islandThemeId buildingThemes version",
            "/islands/{islandId}/inventory,get,buildingThemes,buildingId themeId"})
    void publicDocumentationPreservesRequiredFields(String path, String method, String nested, String fields)
            throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var json = new tools.jackson.databind.ObjectMapper();
        var document = json.readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path(path).path(method).path("responses").path("200").path("content");
        var schema = content.iterator().next().path("schema");
        if (schema.path("type").asText().equals("array")) {
            schema = schema.path("items");
        }
        schema = document.at(schema.path("$ref").asText().substring(1));
        if (nested != null) {
            schema = schema.path("properties").path(nested);
            if (schema.path("type").asText().equals("array")) {
                schema = schema.path("items");
            }
            schema = document.at(schema.path("$ref").asText().substring(1));
        }
        var required = new java.util.ArrayList<String>();
        schema.path("required").forEach(value -> required.add(value.asText()));
        assertThat(required).containsExactlyInAnyOrder(fields.split(" "));
    }

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
