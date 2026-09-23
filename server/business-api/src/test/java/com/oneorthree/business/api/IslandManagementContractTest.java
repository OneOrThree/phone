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
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 관리·주민 공개 6종의 계약 (GROMO-1802) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 *
 * <p>권한·원자 변경은 data-api 의 {@code IslandManagementIntegrationTest} 가 본다. 여기서 보는 것은 경계다:
 * 주체·멱등키 전달, 본문 화이트리스트, 목록 커서 서명, 상류 실패의 공개 코드 변환(특히 400→409 두 건).
 */
class IslandManagementContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1802-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1802-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1802-0000-0000-000000000001");
    private static final UUID REQUEST = UUID.fromString("dddddddd-1802-0000-0000-000000000001");
    private static final UUID TARGET = UUID.fromString("eeeeeeee-1802-0000-0000-000000000001");
    private static final String KEY = "ffffffff-1802-5000-8000-000000000001";

    private static final String DATA_MANAGE = "PATCH /internal/islands/" + ISLAND;
    private static final String DATA_MEMBERS = "GET /internal/islands/" + ISLAND + "/members";
    private static final String DATA_REQUESTS = "GET /internal/islands/" + ISLAND + "/join-requests";
    private static final String DATA_ANSWER = "PATCH /internal/islands/" + ISLAND + "/join-requests/" + REQUEST;
    private static final String DATA_KICK = "DELETE /internal/islands/" + ISLAND + "/members/" + TARGET;
    private static final String DATA_LEAVE = "DELETE /internal/users/" + USER + "/islands/" + ISLAND + "/membership";

    private static final String MANAGED = "{\"id\":\"" + ISLAND + "\",\"name\":\"새섬\",\"intro\":\"\","
            + "\"approvalRequired\":true,\"maxMembers\":15,\"version\":4}";
    private static final String MEMBERS = "{\"items\":[{\"id\":\"" + USER + "\",\"name\":\"고양이\","
            + "\"catColor\":\"cream\",\"role\":\"host\",\"appearance\":{\"clothes\":\"scarf\",\"decor\":null,"
            + "\"hull\":\"raft\",\"position\":\"front\",\"version\":2}}],"
            + "\"nextJoinedAt\":\"2026-09-19T01:02:03.123456Z\",\"nextMembershipId\":\"" + TARGET + "\",\"version\":9}";
    private static final String REQUESTS = "{\"items\":[{\"id\":\"" + REQUEST + "\",\"applicantId\":\"" + TARGET
            + "\",\"name\":\"신청자\",\"status\":\"pending\",\"version\":0}],\"nextCreatedAt\":null,\"nextRequestId\":null}";

    // ---------------------------------------------------------------- manage

    @Test
    @DisplayName("정보 수정은 보낸 키만 상류에 넘기고 서명 주체·멱등키를 전달한다")
    void manageForwardsOnlyGivenFields() throws Exception {
        DATA.on(DATA_MANAGE, request -> ok(MANAGED));

        mockMvc.perform(write(patch("/islands/" + ISLAND),
                        "{\"name\":\"새섬\",\"approvalRequired\":true,\"maxMembers\":12}")
                        .header("X-User-Id", TARGET))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("새섬"))
                .andExpect(jsonPath("$.data.maxMembers").value(15))
                .andExpect(jsonPath("$.data.version").value(4));

        MockUpstream.RecordedRequest sent = DATA.receivedFor(DATA_MANAGE).get(0);
        assertThat(sent.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(sent.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(sent.body()).isEqualTo("{\"name\":\"새섬\",\"approvalRequired\":true,\"maxMembers\":12}");
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "{\"name\":null}|400|INVALID_REQUEST",
        "{\"password\":\"1234\"}|400|INVALID_REQUEST",
        "{\"approvalRequired\":\"true\"}|400|INVALID_REQUEST",
        "{\"maxMembers\":16}|400|INVALID_REQUEST",
        "{\"maxMembers\":0}|400|INVALID_REQUEST",
        "{\"maxMembers\":-1}|400|INVALID_REQUEST",
        "{\"maxMembers\":\"15\"}|400|INVALID_REQUEST",
        // 32비트 경계 — 자르고 나서 범위를 보면 4294967297 이 1 로 접혀 정원이 1 로 저장된다.
        "{\"maxMembers\":2147483648}|400|INVALID_REQUEST",
        "{\"maxMembers\":4294967297}|400|INVALID_REQUEST",
        "{\"name\":\"   \"}|422|OUT_OF_RANGE",
        "{\"name\":\"\"}|422|OUT_OF_RANGE",
        "{\"intro\":null}|400|INVALID_REQUEST"})
    @DisplayName("정보 수정 본문 — 명시 null·계약 밖 키·타입 오류는 400, 빈 이름은 422 이고 상류에 닿지 않는다")
    void manageRejectsBadBodiesBeforeTheNetwork(String body, int expected, String code) throws Exception {
        mockMvc.perform(write(patch("/islands/" + ISLAND), body))
                .andExpect(status().is(expected))
                .andExpect(jsonPath("$.error.code").value(code));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("정보 수정 응답의 섬이 요청과 다르면 400 다")
    void manageResponseForAnotherIslandIsAContractError() throws Exception {
        DATA.on(DATA_MANAGE, request -> ok(MANAGED.replace(ISLAND.toString(), TARGET.toString())));
        mockMvc.perform(write(patch("/islands/" + ISLAND), "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 목록

    @Test
    @DisplayName("주민 목록 — 평문 경계는 서명 커서로 감싸고, 다음 요청에서 풀어 상류에 넘긴다. 다른 섬엔 못 쓴다")
    void membersCursorIsSignedAndBoundToTheIsland() throws Exception {
        DATA.on(DATA_MEMBERS, request -> ok(MEMBERS));

        MvcResult first = mockMvc.perform(auth(get("/islands/" + ISLAND + "/members")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].role").value("host"))
                .andExpect(jsonPath("$.data.items[0].catColor").value("cream"))
                .andExpect(jsonPath("$.data.items[0].appearance.clothes").value("scarf"))
                .andExpect(jsonPath("$.data.items[0].appearance.version").value(2))
                .andExpect(jsonPath("$.data.version").value(9))
                .andExpect(jsonPath("$.data.nextJoinedAt").doesNotExist())
                .andExpect(jsonPath("$.data.nextCursor").isNotEmpty()).andReturn();
        assertThat(DATA.receivedFor(DATA_MEMBERS).get(0).query()).contains("limit=30")
                .doesNotContain("afterJoinedAt");
        String cursor = com.jayway.jsonpath.JsonPath.read(first.getResponse().getContentAsString(),
                "$.data.nextCursor");
        assertThat(cursor).doesNotContain(TARGET.toString());

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/members")).param("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_MEMBERS).get(1).query())
                .contains("afterMembershipId=" + TARGET).contains("afterJoinedAt=2026-09-19T01");

        int before = DATA.hits(DATA_MEMBERS);
        mockMvc.perform(auth(get("/islands/" + TARGET + "/members")).param("cursor", cursor))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.hits(DATA_MEMBERS)).isEqualTo(before);
    }

    @Test
    @DisplayName("신청자 목록 — 마지막 페이지면 nextCursor 가 없고, 방장 아님(403)은 빈 목록으로 접지 않는다")
    void joinRequestsLastPageAndForbidden() throws Exception {
        DATA.on(DATA_REQUESTS, request -> ok(REQUESTS));
        mockMvc.perform(auth(get("/islands/" + ISLAND + "/join-requests")).param("limit", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].applicantId").value(TARGET.toString()))
                .andExpect(jsonPath("$.data.nextCursor").doesNotExist());

        DATA.reset();
        DATA.on(DATA_REQUESTS, request -> error(403, "NOT_OWNER"));
        mockMvc.perform(auth(get("/islands/" + ISLAND + "/join-requests")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    // ---------------------------------------------------------------- request-answer

    @Test
    @DisplayName("승인은 memberId 를, 거절은 memberId:null 을 돌려준다")
    void answerShapesApproveAndReject() throws Exception {
        DATA.on(DATA_ANSWER, request -> ok("{\"status\":\"approved\",\"memberId\":\"" + TARGET + "\",\"version\":1}"));
        mockMvc.perform(write(patch("/islands/" + ISLAND + "/join-requests/" + REQUEST), "{\"decision\":\"approve\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("approved"))
                .andExpect(jsonPath("$.data.memberId").value(TARGET.toString()));
        assertThat(DATA.receivedFor(DATA_ANSWER).get(0).body()).isEqualTo("{\"decision\":\"approve\"}");

        DATA.reset();
        DATA.on(DATA_ANSWER, request -> ok("{\"status\":\"rejected\",\"version\":1}"));
        mockMvc.perform(write(patch("/islands/" + ISLAND + "/join-requests/" + REQUEST), "{\"decision\":\"reject\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("rejected"))
                .andExpect(jsonPath("$.data.memberId").value(nullValue()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"decision\":true}", "{\"decision\":\"approve\",\"x\":1}"})
    @DisplayName("처리 본문은 정확히 decision 하나다")
    void answerRejectsMalformedBodies(String body) throws Exception {
        mockMvc.perform(write(patch("/islands/" + ISLAND + "/join-requests/" + REQUEST), body))
                .andExpect(status().isBadRequest());
        mockMvc.perform(write(patch("/islands/" + ISLAND + "/join-requests/" + REQUEST), "{\"decision\":\"maybe\"}"))
                .andExpect(status().isUnprocessableEntity());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("승인 응답의 상태가 결정과 어긋나면 400 다")
    void answerMismatchIsAContractError() throws Exception {
        DATA.on(DATA_ANSWER, request -> ok("{\"status\":\"rejected\",\"version\":1}"));
        mockMvc.perform(write(patch("/islands/" + ISLAND + "/join-requests/" + REQUEST), "{\"decision\":\"approve\"}"))
                .andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------- kick / leave

    @Test
    @DisplayName("강퇴·나가기는 본문 없이 멱등키만 전달하고 최소 결과만 돌려준다 — 나가기는 사용자 축 경로다")
    void kickAndLeaveForwardKeysAndReturnMinimalEvidence() throws Exception {
        DATA.on(DATA_KICK, request -> ok("{\"removed\":true}"));
        DATA.on(DATA_LEAVE, request -> ok("{\"left\":true}"));

        mockMvc.perform(auth(delete("/islands/" + ISLAND + "/members/" + TARGET)).header("Idempotency-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.removed").value(true));
        mockMvc.perform(auth(delete("/islands/" + ISLAND + "/memberships/me")).header("Idempotency-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.left").value(true));

        assertThat(DATA.receivedFor(DATA_KICK).get(0).header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(DATA.receivedFor(DATA_LEAVE).get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("명령 4종은 UUID 멱등키가 없으면 상류에 닿지 않는다")
    void commandsRequireAnIdempotencyKey() throws Exception {
        mockMvc.perform(auth(delete("/islands/" + ISLAND + "/members/" + TARGET)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(auth(delete("/islands/" + ISLAND + "/memberships/me")))
                .andExpect(status().isBadRequest());
        mockMvc.perform(auth(patch("/islands/" + ISLAND)).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    // ---------------------------------------------------------------- 오류 변환

    @ParameterizedTest
    @CsvSource({
        "DELETE_KICK,400,CANNOT_KICK_SELF,409,STATE_CONFLICT",
        "DELETE_KICK,404,NOT_FOUND,404,NOT_FOUND",
        "DELETE_KICK,404,TARGET_USER_NOT_FOUND,404,NOT_FOUND",
        "DELETE_KICK,403,NOT_OWNER,403,FORBIDDEN",
        "DELETE_KICK,503,ISLAND_MANAGEMENT_NOT_READY,400,SERVICE_UNAVAILABLE",
        "DELETE_LEAVE,400,HOST_WITHDRAW,409,STATE_CONFLICT",
        "DELETE_LEAVE,409,SESSION_IN_PROGRESS,409,STATE_CONFLICT",
        "DELETE_LEAVE,403,MEMBER_ONLY,403,FORBIDDEN",
        "DELETE_LEAVE,404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND",
        "PATCH_ANSWER,409,JOIN_REQUEST_TERMINAL,409,STATE_CONFLICT",
        "PATCH_ANSWER,409,ROOM_FULL,409,STATE_CONFLICT",
        "PATCH_ANSWER,403,KICKED_CANNOT_REJOIN,409,STATE_CONFLICT",
        "PATCH_ANSWER,404,JOIN_REQUEST_NOT_FOUND,404,NOT_FOUND",
        "PATCH_ANSWER,410,INVITATION_EXPIRED,410,INVITATION_EXPIRED",
        "PATCH_MANAGE,400,INVALID_REQUEST,400,INVALID_REQUEST",
        "PATCH_MANAGE,403,NOT_OWNER,403,FORBIDDEN",
        "PATCH_MANAGE,422,ISLAND_NAME_BLANK,422,OUT_OF_RANGE",
        // 정원 축소 거절 — 모양이 아니라 현원이 거절 이유라 409 다. 등록이 빠지면 502 로 새 나간다.
        "PATCH_MANAGE,400,MAX_MEMBERS_TOO_SMALL,409,STATE_CONFLICT",
        // 상태가 어긋난 같은 이름은 옮기지 않는다 — 조용한 오역 대신 502.
        "DELETE_KICK,409,CANNOT_KICK_SELF,400,UPSTREAM_CONTRACT_ERROR"})
    @DisplayName("상류 판정은 (상태, 코드) 쌍이 맞을 때만 공개 코드로 옮긴다 — legacy 400 세 건은 409 가 된다")
    void mapsUpstreamFailuresByStatusAndCode(String route, int upstream, String code, int expected,
            String publicCode) throws Exception {
        MockHttpServletRequestBuilder request;
        String dataRoute;
        switch (route) {
            case "DELETE_KICK" -> {
                dataRoute = DATA_KICK;
                request = auth(delete("/islands/" + ISLAND + "/members/" + TARGET)).header("Idempotency-Key", KEY);
            }
            case "DELETE_LEAVE" -> {
                dataRoute = DATA_LEAVE;
                request = auth(delete("/islands/" + ISLAND + "/memberships/me")).header("Idempotency-Key", KEY);
            }
            case "PATCH_ANSWER" -> {
                dataRoute = DATA_ANSWER;
                request = write(patch("/islands/" + ISLAND + "/join-requests/" + REQUEST), "{\"decision\":\"approve\"}");
            }
            default -> {
                dataRoute = DATA_MANAGE;
                request = write(patch("/islands/" + ISLAND), "{\"name\":\"새섬\"}");
            }
        }
        DATA.on(dataRoute, r -> error(upstream, code));
        mockMvc.perform(request)
                .andExpect(status().is(expected))
                .andExpect(jsonPath("$.error.code").value(publicCode));
    }

    // ---------------------------------------------------------------- 도구


    @ParameterizedTest
    @ValueSource(strings = {"manage", "approve", "reject", "members", "members-null", "members-empty",
            "requests", "requests-null", "requests-empty"})
    @DisplayName("섬 관리 공개 JSON은 중첩 외양·null·빈 목록을 보존하고 내부 경계를 노출하지 않는다")
    void publicManagementContract(String operation) throws Exception {
        var json = new tools.jackson.databind.ObjectMapper();
        String source;
        String route;
        MockHttpServletRequestBuilder request;
        if (operation.equals("manage")) {
            source = MANAGED;
            route = DATA_MANAGE;
            request = write(patch("/islands/" + ISLAND), "{}");
        } else if (operation.equals("approve") || operation.equals("reject")) {
            source = "{\"status\":\"" + (operation.equals("approve") ? "approved" : "rejected")
                    + "\",\"memberId\":" + (operation.equals("approve") ? "\"" + TARGET + "\"" : "null")
                    + ",\"version\":1}";
            route = DATA_ANSWER;
            request = write(patch("/islands/" + ISLAND + "/join-requests/" + REQUEST),
                    "{\"decision\":\"" + operation + "\"}");
        } else {
            boolean members = operation.startsWith("members");
            source = members ? MEMBERS : REQUESTS;
            route = members ? DATA_MEMBERS : DATA_REQUESTS;
            request = auth(get("/islands/" + ISLAND + (members ? "/members" : "/join-requests")));
        }
        var upstream = (tools.jackson.databind.node.ObjectNode) json.readTree(source);
        var expected = upstream.deepCopy();
        if (operation.startsWith("members") || operation.startsWith("requests")) {
            for (String field : new String[]{"nextJoinedAt", "nextMembershipId", "nextCreatedAt", "nextRequestId"}) {
                upstream.remove(field);
                expected.remove(field);
            }
            expected.putNull("nextCursor");
            var items = (tools.jackson.databind.node.ArrayNode) upstream.path("items");
            if (operation.endsWith("empty")) {
                items.removeAll();
                ((tools.jackson.databind.node.ArrayNode) expected.path("items")).removeAll();
            } else {
                var item = (tools.jackson.databind.node.ObjectNode) items.get(0);
                var expectedItem = (tools.jackson.databind.node.ObjectNode) expected.path("items").get(0);
                if (operation.endsWith("null")) {
                    item.putNull("name");
                    expectedItem.putNull("name");
                    if (operation.startsWith("members")) {
                        item.putNull("catColor");
                        expectedItem.putNull("catColor");
                        ((tools.jackson.databind.node.ObjectNode) item.path("appearance")).putNull("clothes");
                        ((tools.jackson.databind.node.ObjectNode) expectedItem.path("appearance")).putNull("clothes");
                    }
                }
                if (operation.startsWith("members")) {
                    ((tools.jackson.databind.node.ObjectNode) item.path("appearance")).put("row_id", "private-appearance");
                }
                item.put("row_id", "private-item");
                var second = item.deepCopy();
                second.put("id", TARGET.toString());
                items.add(second);
                var expectedSecond = expectedItem.deepCopy();
                expectedSecond.put("id", TARGET.toString());
                ((tools.jackson.databind.node.ArrayNode) expected.path("items")).add(expectedSecond);
                items.addNull();
                ((tools.jackson.databind.node.ArrayNode) expected.path("items")).addNull();
            }
        }
        upstream.put("row_id", "private-root");
        DATA.on(route, r -> ok(upstream.toString()));
        var result = mockMvc.perform(request).andExpect(status().isOk()).andReturn();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data")).isEqualTo(expected);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/islands/{islandId}|patch||id name intro approvalRequired maxMembers version|id name intro approvalRequired maxMembers version",
            "/islands/{islandId}/join-requests/{requestId}|patch||status memberId version|status version",
            "/islands/{islandId}/members|get||items nextCursor version|",
            "/islands/{islandId}/members|get|items|id name catColor role appearance|id role appearance",
            "/islands/{islandId}/members|get|items/appearance|clothes decor hull position version|clothes decor hull position version",
            "/islands/{islandId}/join-requests|get||items nextCursor|",
            "/islands/{islandId}/join-requests|get|items|id applicantId name status version|id applicantId status version"})
    void publicDocumentationPreservesFieldsAndPresence(String path, String method, String nested,
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
