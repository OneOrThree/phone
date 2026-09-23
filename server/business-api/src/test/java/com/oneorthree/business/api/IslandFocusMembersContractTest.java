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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 같이 낚시 초기 스냅샷 2종의 계약 (GROMO-1765) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 * 목록·watermark 의 정합은 data-api 통합 테스트가 본다. 여기서는 경계를 본다: 주체, 봉투, 오류 표.
 *
 * <p><b>아래 403 {@code MEMBER_ONLY} 행은 「비소속 금지」가 아니다.</b> 비소속 관전은 2026-09-19 에
 * 열렸고(data-api {@code IslandFocusMembersService}), 지금 Data 가 이 코드를 내는 경우는 <b>없는 섬·
 * 종료된 섬·탈퇴 계정</b>뿐이다. 여기서 고정하는 것은 그 상황이 아니라 <b>상태·코드 쌍의 «옮김»</b>
 * 이다 — 정확히 같은 쌍만 공개 오류가 되고 나머지는 502 라는 규칙.
 */
class IslandFocusMembersContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1765-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1765-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1765-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("dddddddd-1765-0000-0000-000000000001");

    private static final String INTERNAL = "/internal/islands/" + ISLAND;
    private static final String DATA_FOCUS = "GET " + INTERNAL + "/focus-members";
    private static final String DATA_REST = "GET " + INTERNAL + "/rest-members";

    private static final String FOCUS_BODY = "{\"items\":[{\"userId\":\"" + OTHER + "\",\"name\":null,"
            + "\"sessionId\":\"" + SESSION + "\",\"subject\":\"영어 단어\",\"activeSeconds\":1320,"
            + "\"status\":\"active\"}],\"serverNow\":\"2026-09-11T09:10:00Z\","
            + "\"watermarks\":[{\"projection\":\"focus.member\",\"islandId\":\"" + ISLAND + "\","
            + "\"aggregateId\":\"" + OTHER + "\",\"version\":5}]}";
    private static final String REST_BODY = "{\"items\":[{\"userId\":\"" + OTHER + "\",\"name\":\"수아\","
            + "\"restSeat\":1,\"restStartedAt\":\"2026-09-11T09:07:00Z\"}],"
            + "\"serverNow\":\"2026-09-11T09:10:00Z\","
            + "\"watermarks\":[{\"projection\":\"rest.member\",\"islandId\":\"" + ISLAND + "\","
            + "\"aggregateId\":\"" + OTHER + "\",\"version\":2}]}";

    @Test
    @DisplayName("focus-members 는 상류 스냅샷을 data 봉투로 내리고 watermark·null 이름 키를 보존한다")
    void focusMembersPassesThroughInEnvelope() throws Exception {
        DATA.on(DATA_FOCUS, request -> ok(FOCUS_BODY));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/focus-members"))
                        .header("X-User-Id", OTHER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].userId").value(OTHER.toString()))
                .andExpect(jsonPath("$.data.items[0].name").value((Object) null))
                .andExpect(jsonPath("$.data.items[0].sessionId").value(SESSION.toString()))
                .andExpect(jsonPath("$.data.items[0].activeSeconds").value(1320))
                .andExpect(jsonPath("$.data.items[0].status").value("active"))
                .andExpect(jsonPath("$.data.serverNow").value("2026-09-11T09:10:00Z"))
                .andExpect(jsonPath("$.data.watermarks[0].projection").value("focus.member"))
                .andExpect(jsonPath("$.data.watermarks[0].aggregateId").value(OTHER.toString()))
                .andExpect(jsonPath("$.data.watermarks[0].version").value(5));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_FOCUS).get(0);
        assertThat(forwarded.header("X-User-Id")).as("주체는 서명된 세션에서만 온다").isEqualTo(USER.toString());
        assertThat(forwarded.query()).isNull();
    }

    @Test
    @DisplayName("rest-members 는 restSeat·restStartedAt 과 rest.member watermark 를 내린다")
    void restMembersPassesThroughInEnvelope() throws Exception {
        DATA.on(DATA_REST, request -> ok(REST_BODY));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/rest-members")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].name").value("수아"))
                .andExpect(jsonPath("$.data.items[0].restSeat").value(1))
                .andExpect(jsonPath("$.data.items[0].restStartedAt").value("2026-09-11T09:07:00Z"))
                .andExpect(jsonPath("$.data.items[0].sessionId").doesNotExist())
                .andExpect(jsonPath("$.data.watermarks[0].projection").value("rest.member"))
                .andExpect(jsonPath("$.data.watermarks[0].version").value(2));
    }

    @ParameterizedTest
    @CsvSource({"focus-members,403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "rest-members,403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "focus-members,404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "rest-members,409,MEMBER_ONLY,400,UPSTREAM_CONTRACT_ERROR,",
            "focus-members,400,UNKNOWN_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 400 다")
    void mapsOnlyExactDomainStatusAndCode(String route, int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on("GET " + INTERNAL + "/" + route, request -> new MockUpstream.Response(upstreamStatus,
                "{\"code\":\"" + code + "\",\"message\":\"private detail\"}"));

        String body = mockMvc.perform(auth(get("/islands/" + ISLAND + "/" + route)))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("private detail");
    }

    @Test
    @DisplayName("서명 세션이 없거나 islandId 가 UUID 가 아니면 상류를 부르지 않는다")
    void rejectsBeforeTheNetwork() throws Exception {
        mockMvc.perform(get("/islands/" + ISLAND + "/focus-members").header("X-User-Id", USER))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(auth(get("/islands/not-a-uuid/rest-members")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("islandId"));
        assertThat(DATA.received()).isEmpty();
    }


    @ParameterizedTest
    @CsvSource({"focus-members,populated", "rest-members,populated",
            "focus-members,nullable", "rest-members,nullable",
            "focus-members,empty", "rest-members,empty",
            "focus-members,null-entry", "rest-members,null-entry"})
    @DisplayName("주민 공개 JSON은 순서·명시 null·시각 원문을 보존하고 내부 추가 필드를 노출하지 않는다")
    void publicSnapshotContract(String route, String shape) throws Exception {
        var json = new tools.jackson.databind.ObjectMapper();
        var expected = (tools.jackson.databind.node.ObjectNode) json.readTree(
                route.equals("focus-members") ? FOCUS_BODY : REST_BODY);
        expected.put("serverNow", "2026-09-11T18:10:00.123456+09:00");
        var items = (tools.jackson.databind.node.ArrayNode) expected.path("items");
        var watermarks = (tools.jackson.databind.node.ArrayNode) expected.path("watermarks");
        if (shape.equals("empty")) {
            items.removeAll();
            watermarks.removeAll();
        } else if (shape.equals("null-entry")) {
            items.addNull();
            watermarks.addNull();
        } else {
            var second = ((tools.jackson.databind.node.ObjectNode) items.get(0)).deepCopy();
            second.put("userId", USER.toString());
            second.put("name", "두 번째");
            items.add(second);
            var secondWatermark = ((tools.jackson.databind.node.ObjectNode) watermarks.get(0)).deepCopy();
            secondWatermark.put("aggregateId", USER.toString());
            secondWatermark.put("version", 0);
            watermarks.add(secondWatermark);
            if (shape.equals("nullable")) {
                ((tools.jackson.databind.node.ObjectNode) items.get(0)).putNull("name");
            }
        }
        var upstream = expected.deepCopy();
        upstream.put("row_id", "private-root");
        for (var item : upstream.path("items")) {
            if (item.isObject()) {
                ((tools.jackson.databind.node.ObjectNode) item).put("row_id", "private-member");
            }
        }
        for (var watermark : upstream.path("watermarks")) {
            if (watermark.isObject()) {
                ((tools.jackson.databind.node.ObjectNode) watermark).put("row_id", "private-watermark");
            }
        }
        DATA.on("GET " + INTERNAL + "/" + route, request -> ok(upstream.toString()));
        var result = mockMvc.perform(auth(get("/islands/" + ISLAND + "/" + route)))
                .andExpect(status().isOk()).andReturn();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data")).isEqualTo(expected);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/islands/{islandId}/focus-members|get||items serverNow watermarks|items serverNow watermarks",
            "/islands/{islandId}/rest-members|get||items serverNow watermarks|items serverNow watermarks",
            "/islands/{islandId}/focus-members|get|items|userId name sessionId subject activeSeconds status|userId name sessionId subject activeSeconds status",
            "/islands/{islandId}/rest-members|get|items|userId name restSeat restStartedAt|userId name restSeat restStartedAt",
            "/islands/{islandId}/focus-members|get|watermarks|projection islandId aggregateId version|projection islandId aggregateId version",
            "/islands/{islandId}/rest-members|get|watermarks|projection islandId aggregateId version|projection islandId aggregateId version"})
    void publicDocumentationKeepsDistinctMemberFields(String path, String method, String nested,
            String fields, String requiredFields) throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var json = new tools.jackson.databind.ObjectMapper();
        var document = json.readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path(path).path(method).path("responses").path("200").path("content");
        var schema = content.iterator().next().path("schema");
        schema = document.at(schema.path("$ref").asText().substring(1));
        if (nested != null) {
            for (String field : nested.split("/")) {
                schema = schema.path("properties").path(field);
                if (schema.path("type").asText().equals("array")) {
                    schema = schema.path("items");
                }
                schema = document.at(schema.path("$ref").asText().substring(1));
            }
        }
        assertThat(schema.path("properties").size()).as("공개 필드 수").isEqualTo(fields.split(" ").length);
        for (String field : fields.split(" ")) {
            assertThat(schema.path("properties").has(field)).as("공개 필드 %s", field).isTrue();
        }
        var required = new java.util.ArrayList<String>();
        schema.path("required").forEach(value -> required.add(value.asText()));
        assertThat(required).containsExactlyInAnyOrder(requiredFields == null ? new String[0] : requiredFields.split(" "));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
