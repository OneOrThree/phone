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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 집중 세션 수명주기 공개 표면 (GROMO-1764) — 무접두 경로가 Business 에 있고, Data 로는
 * {@code /internal/users/{userId}/…} 로만 나간다는 것을 실제 필터·컨트롤러·HTTP 로 확인한다.
 */
class FocusSessionContractTest extends UpstreamTestBase {

    @Test
    void liveActivityRegistrationUsesAuthenticatedOwnerAndRejectsExtraFields() throws Exception {
        String path = "/focus-sessions/" + FOCUS + "/live-activity";
        String body = "{\"activityId\":\"activity-1\",\"pushToken\":\"" + "ab".repeat(32)
                + "\",\"environment\":\"development\",\"catColor\":\"black\"}";
        DATA.on("PUT " + INTERNAL + path, request -> new MockUpstream.Response(204, ""));
        mockMvc.perform(auth(put(path)).header("X-User-Id", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data").doesNotExist());
        assertThat(DATA.received().get(0).header("x-user-id")).isEqualTo(USER.toString());
        mockMvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(auth(put(path)).contentType(MediaType.APPLICATION_JSON)
                        .content(body.replace("{", "{\"userId\":\"injected\",")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void experienceRewardUsesAuthenticatedUserWithoutSessionOrCommandKey() throws Exception {
        String path = INTERNAL + "/islands/" + ISLAND + "/tutorial-reward";
        DATA.on("POST " + path, request -> ok(
                "{\"islandId\":\"" + ISLAND + "\",\"status\":\"granted\"}"));
        mockMvc.perform(auth(post("/islands/" + ISLAND + "/tutorial-reward")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.islandId").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.status").value("granted"));
        mockMvc.perform(post("/islands/" + ISLAND + "/tutorial-reward"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void malformedExperienceRewardIsNotReportedAsSuccess() throws Exception {
        DATA.on("POST " + INTERNAL + "/islands/" + ISLAND + "/tutorial-reward",
                request -> ok("{\"islandId\":\"" + ISLAND + "\",\"status\":\"pending\"}"));
        mockMvc.perform(auth(post("/islands/" + ISLAND + "/tutorial-reward")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void tutorialRewardUsesAuthenticatedUserAndNeedsNoCommandKey() throws Exception {
        String path = INTERNAL + "/focus-sessions/" + FOCUS + "/tutorial-reward";
        DATA.on("POST " + path, request -> ok(
                "{\"sessionId\":\"" + FOCUS + "\",\"status\":\"granted\"}"));
        mockMvc.perform(auth(post("/focus-sessions/" + FOCUS + "/tutorial-reward"))
                        .header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("granted"))
                .andExpect(jsonPath("$.data.sessionId").value(FOCUS.toString()));
        assertThat(DATA.received().get(0).header("x-user-id")).isEqualTo(USER.toString());
        mockMvc.perform(post("/focus-sessions/" + FOCUS + "/tutorial-reward"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void malformedTutorialRewardIsNotReportedAsSuccess() throws Exception {
        DATA.on("POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/tutorial-reward",
                request -> ok("{\"sessionId\":\"" + FOCUS + "\",\"status\":\"unknown\"}"));
        mockMvc.perform(auth(post("/focus-sessions/" + FOCUS + "/tutorial-reward")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000011");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000011");
    private static final UUID ISLAND = UUID.fromString("cccccccc-0000-0000-0000-000000000011");
    private static final UUID FOCUS = UUID.fromString("dddddddd-0000-0000-0000-000000000011");
    private static final String KEY = "eeeeeeee-0000-5000-8000-000000000011";
    private static final String INTERNAL = "/internal/users/" + USER;
    private static final String DATA_START = "POST " + INTERNAL + "/focus-sessions";
    private static final String DATA_CURRENT = "GET " + INTERNAL + "/focus-sessions/current";
    private static final String DATA_PAUSE = "POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/pause";
    private static final String DATA_SUMMARY = "GET " + INTERNAL + "/focus-summary";
    private static final String DATA_PENDING = "GET " + INTERNAL + "/focus-sessions/pending-result";
    private static final String DATA_ACK = "POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/acknowledge";
    private static final String START_BODY =
            "{\"islandId\":\"" + ISLAND + "\",\"subject\":\"알고리즘\",\"targetMinutes\":60}";
    private static final String STATE = "{\"id\":\"" + FOCUS + "\",\"islandId\":\"" + ISLAND + "\","
            + "\"subject\":\"알고리즘\",\"targetMinutes\":60,\"status\":\"active\",\"activeSeconds\":0,"
            + "\"serverNow\":\"2026-09-17T00:00:00Z\",\"startedAt\":\"2026-09-17T00:00:00Z\","
            + "\"restStartedAt\":null,\"version\":1,\"activeIntervals\":[{\"startedAt\":\"2026-09-17T00:00:00Z\","
            + "\"endedAt\":\"2026-09-17T00:00:00Z\"}]}";
    /** 자동 종료가 남긴 정산 — finish 응답과 «같은 모양»이다(GROMO-1998). */
    private static final String FINISH = "{\"recordId\":\"" + FOCUS + "\",\"islandId\":\"" + ISLAND + "\","
            + "\"subject\":\"알고리즘\",\"targetMinutes\":60,\"activeSeconds\":600,\"goalAchieved\":false,"
            + "\"earnedFish\":10,\"allocation\":{\"personalFishAdded\":0,\"constructionFishAdded\":10},"
            + "\"completedAt\":\"2026-09-17T01:00:00Z\",\"questProgress\":[],"
            + "\"activeIntervals\":[{\"startedAt\":\"2026-09-17T00:00:00Z\",\"endedAt\":\"2026-09-17T01:00:00Z\"}]}";

    @Test
    void startForwardsSignedActorToInternalPathAndReturnsCreatedEnvelope() throws Exception {
        DATA.on(DATA_START, request -> ok(STATE));
        mockMvc.perform(write(post("/focus-sessions"), START_BODY).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.version").value(1))
                .andExpect(jsonPath("$.data.restStartedAt").doesNotExist())
                .andExpect(jsonPath("$.id").doesNotExist());
        assertThat(DATA.hits(DATA_START)).isEqualTo(1);
        var sent = DATA.received().get(0);
        assertThat(sent.header("x-user-id")).isEqualTo(USER.toString());
        assertThat(sent.header("idempotency-key")).isEqualTo(KEY);
        assertThat(sent.body()).contains(ISLAND.toString(), "알고리즘", "60");
    }

    /**
     * 목표 시간은 선택이다(GROMO-1990) — 2필드 본문이 그대로 나가고, {@code targetMinutes} 가 빠진 Data
     * 응답도 그대로 내려간다. 필드 개수 검사는 유지한다: 3인데 targetMinutes 가 아니면 오타다.
     */
    @Test
    void startAcceptsABodyWithoutATargetTime() throws Exception {
        DATA.on(DATA_START, request -> ok(STATE.replace(",\"targetMinutes\":60", "")));
        mockMvc.perform(write(post("/focus-sessions"),
                        "{\"islandId\":\"" + ISLAND + "\",\"subject\":\"알고리즘\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.targetMinutes").doesNotExist());
        assertThat(DATA.hits(DATA_START)).isEqualTo(1);
    }

    /**
     * 구간을 안 보내는 구버전 Data 와 섞여 배포돼도 공개 응답은 {@code activeIntervals} 를 빼고 내린다(GROMO-2131)
     * — 빈 목록으로 채우면 앱이 구간 0건으로 읽어 같은 날 집중을 잃는다.
     */
    @Test
    void currentOmitsActiveIntervalsWhenDataDoesNotSendThem() throws Exception {
        String legacy = STATE.substring(0, STATE.indexOf(",\"activeIntervals\"")) + "}";
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + legacy + "}"));
        String body = mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(FOCUS.toString()))
                .andReturn().getResponse().getContentAsString();
        // doesNotExist 는 명시 null 도 통과시키므로 키 자체가 없는지 본다.
        assertThat(body).doesNotContain("activeIntervals");
    }

    /** 집중섬 자리(GROMO-2477)는 넷째 선택 필드다 — 좌표를 그대로 Data 로 넘기고, 없으면 키째 뺀다(옛 앱 본문 그대로). */
    @Test
    void startForwardsTheSeatOnlyWhenTheAppSendsIt() throws Exception {
        DATA.on(DATA_START, request -> ok(STATE));
        mockMvc.perform(write(post("/focus-sessions"),
                        START_BODY.replace("}", ",\"seat\":{\"x\":12.5,\"y\":40.25}}")))
                .andExpect(status().isCreated());
        assertThat(DATA.received().get(0).body()).contains("\"seat\":{\"x\":12.5,\"y\":40.25}");

        mockMvc.perform(write(post("/focus-sessions"), START_BODY)).andExpect(status().isCreated());
        assertThat(DATA.received().get(1).body()).doesNotContain("seat");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\"}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\",\"oops\":1}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"targetMinutes\":1.5}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"targetMinutes\":\"60\"}",
            // 넷째 필드는 seat 만 된다 — targetMinutes 와 함께 오타가 오거나 다섯째가 붙으면 거절
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"targetMinutes\":60,\"oops\":1}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"targetMinutes\":60,\"seat\":{\"x\":1,\"y\":2},\"oops\":1}",
            // seat 는 0~100 숫자 두 개 {x,y} 정확히 — 명시 null·범위 밖·문자열·짝 없음·추가 키 거절
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\",\"seat\":null}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"seat\":{\"x\":101,\"y\":40}}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"seat\":{\"x\":12.5,\"y\":-1}}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"seat\":{\"x\":\"12.5\",\"y\":40}}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"seat\":{\"x\":12.5}}",
            "{\"islandId\":\"cccccccc-0000-0000-0000-000000000011\",\"subject\":\"알고리즘\","
                    + "\"seat\":{\"x\":12.5,\"y\":40,\"z\":1}}"})
    void startRejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(write(post("/focus-sessions"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    /** 세션 없음은 정상값이다 — Data 의 명시 null 키를 벗겨 {@code data:null} 로 내린다. */
    @Test
    void currentReturnsExplicitNullWhenNoSession() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(jsonPath("$.error").doesNotExist());
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + STATE + "}"));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(FOCUS.toString()));
    }

    /** 빈 200 은 「세션 없음」의 증거가 아니다 — 계약 불일치로 502 다. */
    @Test
    void currentRejectsEmptyBodyAsAbsentSession() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok(""));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    /**
     * 키가 «없는» 것과 값이 null 인 것은 다르다 — 전자는 배포가 어긋난 계약 불일치(502)다.
     * 접어서 {@code data:null} 로 내리면 진행 중이던 세션이 사라진 것처럼 보인다.
     */
    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "{\"other\":1}"})
    void currentRejectsBodyWithoutTheSessionKey(String body) throws Exception {
        DATA.on(DATA_CURRENT, request -> ok(body));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    // ---------------------------------------------------------------- 바다 집중 (GROMO-2299)

    private static final String DATA_SEA_START = "POST " + INTERNAL + "/focus-sessions/sea";
    private static final String DATA_SEA_REMARK = "PUT " + INTERNAL + "/sea-remark";
    private static final String SEA_START_BODY = "{\"destinationIslandId\":\"" + ISLAND + "\"}";
    private static final String SEA_STATE = STATE.replace("\"subject\":\"알고리즘\"", "\"subject\":\"\"")
            .replace("\"version\":1,", "\"version\":1,\"kind\":\"sea\",\"destinationIslandName\":\"바다섬\",");

    /** 본문은 목적지 하나뿐이다 — 상류 경로는 {@code /focus-sessions/sea}, 명령 키와 서명된 주체가 그대로 실린다. */
    @Test
    void startSeaForwardsDestinationOnlyAndReturnsKind() throws Exception {
        DATA.on(DATA_SEA_START, request -> ok(SEA_STATE));
        mockMvc.perform(write(post("/focus-sessions/sea"), SEA_START_BODY).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.kind").value("sea"))
                .andExpect(jsonPath("$.data.destinationIslandName").value("바다섬"))
                .andExpect(jsonPath("$.data.targetMinutes").value(60));
        var sent = DATA.received().get(0);
        assertThat(sent.header("x-user-id")).isEqualTo(USER.toString());
        assertThat(sent.header("idempotency-key")).isEqualTo(KEY);
        assertThat(sent.body()).contains(ISLAND.toString()).doesNotContain("subject");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"destinationIslandId\":1}",
            "{\"destinationIslandId\":\"cccccccc-0000-0000-0000-000000000011\",\"sailingMinutes\":30}"})
    void startSeaRejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(write(post("/focus-sessions/sea"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void startSeaRejectsNonCanonicalDestinationBeforeNetwork() throws Exception {
        mockMvc.perform(write(post("/focus-sessions/sea"), "{\"destinationIslandId\":\"1-2-3-4-5\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("destinationIslandId"));
        assertThat(DATA.received()).isEmpty();
    }

    /** 목적지 섬 이름은 바다 세션 응답에만 실린다 — current 도 같고, 섬 세션·구버전 Data 는 키가 없다(GROMO-2330). */
    @Test
    void currentCarriesDestinationIslandNameOnlyForSeaSessions() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + SEA_STATE + "}"));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.destinationIslandName").value("바다섬"));

        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + STATE + "}"));
        String island = mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(island).doesNotContain("destinationIslandName");
    }

    /** 옛 Data 는 destinationIslandName 을 안 보낸다 — 역직렬화는 통과하고 공개 응답에도 키가 없다(GROMO-2330). */
    @Test
    void seaSessionWithoutDestinationIslandNameFromLegacyDataOmitsTheKey() throws Exception {
        String legacy = SEA_STATE.replace("\"destinationIslandName\":\"바다섬\",", "");
        assertThat(legacy).doesNotContain("destinationIslandName");
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + legacy + "}"));
        String body = mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.kind").value("sea"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("destinationIslandName");
    }

    /** 바다 거절 셋은 같은 이름·상태 그대로 나간다 — 일반 STATE_CONFLICT 로 접히지도, 502 가 되지도 않는다. */
    @ParameterizedTest
    @CsvSource({"409,SEA_DESTINATION_UNAVAILABLE", "409,SEA_SESSION_NO_REST", "409,SEA_REMARK_LOCKED"})
    void seaConflictsKeepTheirNames(int status, String code) throws Exception {
        DATA.on(DATA_SEA_START, request -> error(status, code));
        DATA.on("POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/pause", request -> error(status, code));
        DATA.on(DATA_SEA_REMARK, request -> error(status, code));
        mockMvc.perform(write(post("/focus-sessions/sea"), SEA_START_BODY)).andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/pause"), "{\"expectedVersion\":1}"))
                .andExpect(status().is(status)).andExpect(jsonPath("$.error.code").value(code));
        mockMvc.perform(auth(put("/me/sea-remark")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"remark\":\"안녕\"}"))
                .andExpect(status().is(status)).andExpect(jsonPath("$.error.code").value(code));
    }

    @Test
    void seaRemarkForwardsTrimmedRemarkAndGuestsKeepTheirForbiddenCode() throws Exception {
        DATA.on(DATA_SEA_REMARK, request -> ok("{\"remark\":\"안녕\",\"changedAt\":\"2026-10-17T00:00:00Z\","
                + "\"lockedUntil\":\"2026-10-17T00:05:00Z\"}"));
        mockMvc.perform(auth(put("/me/sea-remark")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"remark\":\"  안녕  \"}").header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.remark").value("안녕"))
                .andExpect(jsonPath("$.data.lockedUntil").value("2026-10-17T00:05:00Z"));
        var sent = DATA.received().get(0);
        assertThat(sent.header("x-user-id")).isEqualTo(USER.toString());
        assertThat(sent.body()).contains("\"remark\":\"안녕\"");

        DATA.on(DATA_SEA_REMARK, request -> error(403, "SOCIAL_LOGIN_REQUIRED"));
        mockMvc.perform(auth(put("/me/sea-remark")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"remark\":\"안녕\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SOCIAL_LOGIN_REQUIRED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"remark\":1}", "{\"remark\":null}",
            "{\"remark\":\"안녕\",\"x\":1}"})
    void seaRemarkRejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(auth(put("/me/sea-remark")).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void seaRemarkLongerThanTwentyIsRejectedBeforeNetworkAndEmptyClears() throws Exception {
        mockMvc.perform(auth(put("/me/sea-remark")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"remark\":\"" + "가".repeat(21) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("remark"));
        assertThat(DATA.received()).isEmpty();

        DATA.on(DATA_SEA_REMARK, request -> ok("{\"remark\":null,\"changedAt\":\"2026-10-17T00:00:00Z\","
                + "\"lockedUntil\":\"2026-10-17T00:05:00Z\"}"));
        mockMvc.perform(auth(put("/me/sea-remark")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"remark\":\"\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.remark").doesNotExist());
        assertThat(DATA.received().get(0).body()).contains("\"remark\":\"\"");
    }

    /** 섬 세션 응답에 {@code kind}·{@code arrived} 가 없던 구버전 Data 와 섞여도 공개 응답에서 키가 빠진다. */
    @Test
    void finishCarriesKindAndArrivedOnlyWhenDataSendsThem() throws Exception {
        String path = "POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/finish";
        DATA.on(path, request -> ok(FINISH));
        String legacy = mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/finish"),
                        "{\"expectedVersion\":3}")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(legacy).doesNotContain("\"kind\"").doesNotContain("\"arrived\"");

        DATA.on(path, request -> ok(FINISH.replace("\"questProgress\":[],",
                "\"questProgress\":[],\"kind\":\"sea\",\"arrived\":true,")));
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/finish"), "{\"expectedVersion\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.kind").value("sea"))
                .andExpect(jsonPath("$.data.arrived").value(true));
    }

    /** 공유 매핑표의 INVALID_REQUEST 는 field 를 붙이지 않는다 — 한마디가 아닌 엔드포인트의 400 에 «remark» 가 실리면 안 된다. */
    @Test
    void upstreamInvalidRequestCarriesNoFieldOnOtherFocusEndpoints() throws Exception {
        DATA.on(DATA_START, request -> error(400, "INVALID_REQUEST"));
        String body = mockMvc.perform(write(post("/focus-sessions"), START_BODY))
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("remark");
        assertThat(body).doesNotContain("\"field\":\"");
    }

    /** 시작 게이트가 닫혀 있는 동안 start 는 재시도 가능한 503 이다 — 502 로 접히지 않는다. */
    @Test
    void startRelaysClosedStartGateAsRetryableUnavailable() throws Exception {
        DATA.on(DATA_START, request -> error(503, "SESSION_START_UNAVAILABLE"));
        mockMvc.perform(write(post("/focus-sessions"), START_BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.retryable").value(true))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    /**
     * 같은 키가 둘이면 400 이다 — {@code @RequestParam String} 은 다중 값을 하나로 축소해
     * {@code ?timezone=Asia/Seoul&timezone=UTC} 를 200 으로 통과시킨다. 모호한 요청은 고르지 않는다.
     */
    @ParameterizedTest
    @CsvSource({"timezone,Asia/Seoul,UTC", "date,2026-09-17,2026-09-18"})
    void summaryRejectsRepeatedQueryParameter(String name, String first, String second) throws Exception {
        mockMvc.perform(auth(get("/me/focus-summary")).queryParam(name, first).queryParam(name, second))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value(name));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void summaryPassesQueryThroughAndKeepsJudgementUpstream() throws Exception {
        DATA.on(DATA_SUMMARY, request -> ok("{\"date\":\"2026-09-17\",\"completedSeconds\":60,"
                + "\"currentSessionSecondsToday\":30,\"totalSeconds\":90,"
                + "\"serverNow\":\"2026-09-17T00:00:00Z\"}"));
        mockMvc.perform(auth(get("/me/focus-summary")).queryParam("date", "2026-09-17")
                        .queryParam("timezone", "Asia/Seoul"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalSeconds").value(90));
        assertThat(DATA.received().get(0).query()).contains("date=2026-09-17", "timezone=Asia/Seoul");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"expectedVersion\":null}", "{\"expectedVersion\":\"1\"}",
            "{\"expectedVersion\":1.5}", "{\"expectedVersion\":true}",
            "{\"expectedVersion\":1,\"status\":\"paused\"}"})
    void pauseRejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/pause"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "9007199254740992"})
    void pauseRejectsVersionOutsideSafeRange(String version) throws Exception {
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/pause"),
                        "{\"expectedVersion\":" + version + "}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("expectedVersion"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void pauseRequiresCommandKeyAndSignedSession() throws Exception {
        String body = "{\"expectedVersion\":1}";
        String path = "/focus-sessions/" + FOCUS + "/pause";
        mockMvc.perform(auth(post(path)).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(post(path).header("Idempotency-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(write(post("/focus-sessions/1-2-3-4-5/pause"), body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.field").value("sessionId"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"409,SESSION_IN_PROGRESS,409,STATE_CONFLICT,",
            "403,ISLAND_NOT_CURRENT,403,FORBIDDEN,islandId",
            "400,INVALID_TARGET_MINUTES,400,INVALID_PARAMETER,targetMinutes",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,ISLAND_NOT_CURRENT,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_FOCUS_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_START, request -> error(upstreamStatus, code));
        var result = mockMvc.perform(write(post("/focus-sessions"), START_BODY))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
    }

    /** 보상 정책 게이트가 닫혀 있는 동안 finish 는 재시도 가능한 503 이다 — 「0원 지급 성공」이 아니다. */
    @Test
    void finishRelaysClosedRewardGateAsRetryableUnavailable() throws Exception {
        DATA.on("POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/finish",
                request -> error(503, "REWARD_POLICY_UNAVAILABLE"));
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/finish"), "{\"expectedVersion\":3}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.retryable").value(true))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    /**
     * 휴식 1시간 자동 종료 결과 조회 (GROMO-1998). 보여 줄 것이 없으면 {@code data:null} 이고, 빈 200 은
     * 그 증거가 아니라 계약 불일치다 — {@code current} 와 같은 규칙이다.
     */
    @Test
    void pendingResultUnwrapsTheEnvelopeAndTreatsAnEmptyBodyAsAContractError() throws Exception {
        DATA.on(DATA_PENDING, request -> ok("{\"result\":null}"));
        mockMvc.perform(auth(get("/focus-sessions/pending-result"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(jsonPath("$.error").doesNotExist());

        DATA.on(DATA_PENDING, request -> ok("{\"result\":" + FINISH + "}"));
        mockMvc.perform(auth(get("/focus-sessions/pending-result"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.recordId").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.earnedFish").value(10))
                .andExpect(jsonPath("$.data.allocation.constructionFishAdded").value(10));

        DATA.on(DATA_PENDING, request -> ok(""));
        mockMvc.perform(auth(get("/focus-sessions/pending-result"))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    /**
     * 확인은 본문도 멱등 키도 없다 — Data 의 조건부 UPDATE 가 최초 1회만 세팅하므로 재시도가 무해하다.
     * 204 는 공통 advice 가 200 {@code data:null} 로 바꾼다.
     */
    @Test
    void acknowledgeNeedsNoBodyOrKeyAndIsSafeToRetry() throws Exception {
        DATA.on(DATA_ACK, request -> new MockUpstream.Response(204, ""));

        for (int attempt = 0; attempt < 2; attempt++) {
            mockMvc.perform(auth(post("/focus-sessions/" + FOCUS + "/acknowledge")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data").doesNotExist())
                    .andExpect(jsonPath("$.error").doesNotExist());
        }

        assertThat(DATA.hits(DATA_ACK)).isEqualTo(2);
        assertThat(DATA.received().get(0).header("x-user-id")).isEqualTo(USER.toString());
    }

    /** 남의 세션 확인은 Data 가 403 으로 거절하고, 그 판정이 공개 FORBIDDEN 으로 내려간다. */
    @Test
    void acknowledgeRelaysForbiddenForSomeoneElsesSession() throws Exception {
        DATA.on(DATA_ACK, request -> error(403, "FORBIDDEN"));
        mockMvc.perform(auth(post("/focus-sessions/" + FOCUS + "/acknowledge")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @ParameterizedTest
    @CsvSource({"/focus-sessions/current,get,,id islandId subject status activeSeconds serverNow startedAt version",
            "/focus-sessions/{sessionId}/finish,post,,recordId islandId subject activeSeconds goalAchieved earnedFish allocation completedAt",
            "/focus-sessions/{sessionId}/finish,post,allocation,personalFishAdded constructionFishAdded",
            "/focus-sessions/{sessionId}/finish,post,questProgress,id myRate",
            "/me/focus-summary,get,,date completedSeconds currentSessionSecondsToday totalSeconds serverNow"})
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

    @ParameterizedTest
    @ValueSource(strings = {"start", "current", "pause", "resume"})
    void stateResponsesExposeOnlyPublicFieldsAndPreserveNullsAndTimestampText(String operation) throws Exception {
        String expected = STATE.replace("\"targetMinutes\":60", "\"targetMinutes\":null")
                .replace("2026-09-17T00:00:00Z", "2026-09-17T00:00:00.123456+00:00");
        String upstream = expected.substring(0, expected.length() - 1) + ",\"policy_revision\":7}";
        String path = switch (operation) {
            case "start" -> "/focus-sessions";
            case "current" -> "/focus-sessions/current";
            default -> "/focus-sessions/" + FOCUS + "/" + operation;
        };
        boolean current = operation.equals("current");
        String response = current ? "{\"session\":" + upstream + "}" : upstream;
        DATA.on((current ? "GET " : "POST ") + INTERNAL + path, request -> ok(response));
        var request = current ? auth(get(path))
                : write(post(path), operation.equals("start") ? START_BODY : "{\"expectedVersion\":1}");

        var result = mockMvc.perform(request).andExpect(status().is(operation.equals("start") ? 201 : 200))
                .andReturn();
        var json = new tools.jackson.databind.ObjectMapper();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data"))
                .isEqualTo(json.readTree(expected));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void finishAndPendingResponsesProjectNestedPublicFields(boolean pending) throws Exception {
        String expected = FINISH.replace("\"questProgress\":[]", "\"questProgress\":[{\"id\":\""
                + ISLAND + "\",\"myRate\":0.25}]");
        String upstream = expected.replace("\"constructionFishAdded\":10}",
                "\"constructionFishAdded\":10,\"ledger_row_id\":3}")
                .replace("\"myRate\":0.25}", "\"myRate\":0.25,\"internal_count\":2}");
        upstream = upstream.substring(0, upstream.length() - 1) + ",\"policy_revision\":7}";
        String path = pending ? "/focus-sessions/pending-result" : "/focus-sessions/" + FOCUS + "/finish";
        String response = pending ? "{\"result\":" + upstream + "}" : upstream;
        DATA.on((pending ? "GET " : "POST ") + INTERNAL + path, request -> ok(response));

        var result = mockMvc.perform(pending ? auth(get(path)) : write(post(path), "{\"expectedVersion\":1}"))
                .andExpect(status().isOk()).andReturn();
        var json = new tools.jackson.databind.ObjectMapper();
        // 상류가 seaReward 를 안 보내는 구버전 Data 여도 공개 응답에는 키가 있고 null 이다(GROMO-2274 — 섬 세션 = null).
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data"))
                .isEqualTo(json.readTree(withSeaReward(expected, "null")));
    }

    /**
     * 집중 꾸미기 보상 (GROMO-2274 모양 · GROMO-2301 NEW!) — 상류의 {@code seaReward} 는 공개 세 필드만 내려가고, 구버전
     * Data 의 null 은 키째 보존된다. 상품이 없어도 객체({@code grantedProductIds:[]})이고, 다음 단계가 없으면 남은 분이 명시
     * null 이다. {@code newProductIds} 를 모르는 구버전 Data 면 빈 목록으로 채운다.
     */
    @Test
    void finishProjectsTheSeaRewardWithoutLeakingUpstreamFields() throws Exception {
        String firstWin = "{\"grantedProductIds\":[\"cust.head.hat\"],\"minutesToNextTier\":null,"
                + "\"newProductIds\":[\"cust.head.hat\"]}";
        assertFinishSeaReward(firstWin.replace("]}", "],\"ledger\":1}"), firstWin);
        String duplicate = "{\"grantedProductIds\":[\"cust.head.hat\"],\"minutesToNextTier\":null,"
                + "\"newProductIds\":[]}";
        assertFinishSeaReward(duplicate, duplicate);
        String legacy = "{\"grantedProductIds\":[\"sea-scarf\",\"sea-hat\"],\"minutesToNextTier\":12}";
        assertFinishSeaReward(legacy, legacy.replace("12}", "12,\"newProductIds\":[]}"));
        String empty = "{\"grantedProductIds\":[],\"minutesToNextTier\":null}";
        assertFinishSeaReward(empty, empty.replace("null}", "null,\"newProductIds\":[]}"));
        assertFinishSeaReward("null", "null");
    }

    private void assertFinishSeaReward(String upstreamSeaReward, String publicSeaReward) throws Exception {
        String upstream = withSeaReward(FINISH, upstreamSeaReward);
        DATA.on("POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/finish", request -> ok(upstream));

        var result = mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/finish"), "{\"expectedVersion\":1}"))
                .andExpect(status().isOk()).andReturn();

        var json = new tools.jackson.databind.ObjectMapper();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data"))
                .isEqualTo(json.readTree(withSeaReward(FINISH, publicSeaReward)));
    }

    /** {@code seaReward} 키가 없는 응답 JSON 끝에 그 키를 붙인다. */
    private static String withSeaReward(String finishJson, String seaRewardJson) {
        return finishJson.substring(0, finishJson.length() - 1) + ",\"seaReward\":" + seaRewardJson + "}";
    }

    @Test
    void summaryExposesOnlyPublicFields() throws Exception {
        String expected = "{\"date\":\"2026-09-17\",\"completedSeconds\":60,\"currentSessionSecondsToday\":30,"
                + "\"totalSeconds\":90,\"serverNow\":\"2026-09-17T01:00:00.123456+00:00\"}";
        DATA.on(DATA_SUMMARY, request -> ok(expected.substring(0, expected.length() - 1)
                + ",\"aggregate_row_id\":4}"));

        var result = mockMvc.perform(auth(get("/me/focus-summary"))).andExpect(status().isOk()).andReturn();
        var json = new tools.jackson.databind.ObjectMapper();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data"))
                .isEqualTo(json.readTree(expected));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).header("Idempotency-Key", KEY)
                .contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
