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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 망원경 목록 공개 계약 (GROMO-2265) — 실제 필터·컨트롤러·TCP 클라이언트로 경계를 본다.
 *
 * <p>조립 규칙(칸·시드·항해 분·정원 찬 섬 채우기·게이트 없음)은 data-api 의 {@code TelescopeIntegrationTest} 가 본다.
 * 여기서 보는 것은 주체 전달, 공개 모양(필드 그대로·상류 내부 필드 차단·null 평균 유지), 상류 실패의 공개 오류 표다.
 *
 * <p>망원경 핀(GROMO-2268)의 공개 두 경로도 같은 방식으로 본다 — 본문 모양, 201/200 상태 코드, {@code created} 의 비공개,
 * 밀려난 핀의 {@code evicted}, 핀 칸에만 있는 {@code pinnedFrom}·{@code pinnedAt}, 오류 매핑(404·403→FORBIDDEN·409→STATE_CONFLICT).
 * 넣기·밀어내기·만료 판정은 data-api 의 {@code TelescopePinIntegrationTest} 가 실제 DB 로 본다.
 *
 * <p>잡지 경유(GROMO-2289) — 핀 본문의 선택 {@code promotionId} 전달과 모든 칸의 {@code magazineCell}(null 이어도 키 유지,
 * 이 필드를 모르는 옛 Data 응답은 null 로 읽기)도 여기서 본다.
 */
class TelescopeContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-2265-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-2265-0000-0000-000000000001");
    private static final UUID HOME = UUID.fromString("cccccccc-2265-0000-0000-000000000001");
    private static final UUID NEARBY = UUID.fromString("dddddddd-2265-0000-0000-000000000001");
    private static final UUID PINNED = UUID.fromString("eeeeeeee-2268-0000-0000-000000000001");
    private static final UUID EVICTED = UUID.fromString("ffffffff-2268-0000-0000-000000000001");
    private static final UUID PROMOTION = UUID.fromString("01990000-2289-7000-8000-000000000009");

    private static final String DATA_TELESCOPE = "GET /internal/users/" + USER + "/telescope";
    private static final String TELESCOPE = "/me/telescope";
    private static final String PINS = "/me/telescope/pins";
    private static final String DATA_PIN = "POST /internal/users/" + USER + "/telescope/pins";
    private static final String DATA_UNPIN = "DELETE /internal/users/" + USER + "/telescope/pins/" + PINNED;

    private static final String LIST = "{\"bucketStart\":\"2026-10-12T05:00:00Z\",\"nextRefreshMinutes\":37,"
            + "\"items\":[{\"islandId\":\"" + HOME + "\",\"name\":\"윤슬\",\"intro\":\"같이 집중해요\","
            + "\"memberCount\":2,\"maxMembers\":5,\"approvalRequired\":false,\"membershipStatus\":\"active\","
            + "\"slot\":\"joined\",\"sailingMinutes\":60,\"averageFocusMinutesPerDay\":83,\"full\":false,"
            + "\"arrivedBefore\":true},"
            + "{\"islandId\":\"" + NEARBY + "\",\"name\":\"물결\",\"intro\":\"\",\"memberCount\":1,"
            + "\"maxMembers\":10,\"approvalRequired\":true,\"membershipStatus\":\"pending\",\"slot\":\"nearby\","
            + "\"sailingMinutes\":15,\"averageFocusMinutesPerDay\":null,\"full\":false,\"arrivedBefore\":false}]}";

    /** 핀 칸 — {@code pinnedFrom}·{@code pinnedAt} 이 값으로 있다. */
    private static final String PINNED_ITEM = "{\"islandId\":\"" + PINNED + "\",\"name\":\"파도\",\"intro\":\"\","
            + "\"memberCount\":3,\"maxMembers\":15,\"approvalRequired\":false,\"membershipStatus\":\"none\","
            + "\"slot\":\"pinned\",\"sailingMinutes\":60,\"averageFocusMinutesPerDay\":null,\"full\":false,"
            + "\"arrivedBefore\":false,\"pinnedFrom\":\"magazine\",\"pinnedAt\":\"2026-10-12T05:23:41Z\"}";

    /** 잡지 홍보 칸 — 잡지 한 호의 칸과 같은 모양이고 layout 은 Business 가 속을 보지 않는다. */
    private static final String CELL = "{\"promotionId\":\"" + PROMOTION + "\",\"islandId\":\"" + PINNED + "\","
            + "\"name\":\"파도\",\"buildingCount\":4,\"memberCount\":3,\"maxMembers\":15,"
            + "\"averageFocusMinutesPerDay\":null,\"body\":\"놀러 오세요\",\"layout\":{\"v\":1,\"future\":[1]},"
            + "\"relation\":\"NONE\"}";
    /** 잡지에서 넣은 핀 칸 — {@code magazineCell} 이 값으로 있다. */
    private static final String MAGAZINE_ITEM = PINNED_ITEM.replace("}", ",\"magazineCell\":" + CELL + "}");

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
                .isEqualTo(withNullCells(LIST));
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
        "averageFocusMinutesPerDay 누락", "magazineCell.layout 누락"})
    @DisplayName("상류 응답의 필수 키 누락·null·null 칸은 공개 목록 대신 계약 오류다")
    void malformedUpstreamListsAreContractErrors(String shape) throws Exception {
        String body = switch (shape) {
            case "items 누락" -> "{\"bucketStart\":\"2026-10-12T05:00:00Z\",\"nextRefreshMinutes\":37}";
            case "items:[null]" ->
                    "{\"bucketStart\":\"2026-10-12T05:00:00Z\",\"nextRefreshMinutes\":37,\"items\":[null]}";
            case "bucketStart 누락" -> "{\"nextRefreshMinutes\":37,\"items\":[]}";
            case "bucketStart:null" -> "{\"bucketStart\":null,\"nextRefreshMinutes\":37,\"items\":[]}";
            case "averageFocusMinutesPerDay 누락" -> LIST.replace("\"averageFocusMinutesPerDay\":null,", "");
            case "magazineCell.layout 누락" -> LIST.replace("]}", ","
                    + MAGAZINE_ITEM.replace(",\"layout\":{\"v\":1,\"future\":[1]}", "") + "]}");
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

    // ---------------------------------------------------------------- 핀 (GROMO-2268)

    @Test
    @DisplayName("핀 칸에만 pinnedFrom·pinnedAt 이 있다 — 나머지 칸은 상류가 null 을 보내도 키 자체를 내리지 않는다")
    void pinFieldsAppearOnlyOnPinnedItems() throws Exception {
        String pinnedList = LIST.replace("\"arrivedBefore\":true}", "\"arrivedBefore\":true,"
                + "\"pinnedFrom\":null,\"pinnedAt\":null}").replace("]}", "," + PINNED_ITEM + "]}");
        DATA.on(DATA_TELESCOPE, request -> ok(pinnedList));

        var result = mockMvc.perform(auth(get(TELESCOPE))).andExpect(status().isOk()).andReturn();

        ObjectMapper json = new ObjectMapper();
        var items = json.readTree(result.getResponse().getContentAsString()).path("data").path("items");
        assertThat(items.get(0).has("pinnedFrom")).isFalse();
        assertThat(items.get(0).has("pinnedAt")).isFalse();
        assertThat(items.get(1).has("pinnedFrom")).isFalse();
        assertThat(items.get(2)).isEqualTo(withNullCells("{\"items\":[" + PINNED_ITEM + "]}").path("items").get(0));
    }

    @Test
    @DisplayName("잡지에서 넣은 칸은 magazineCell 을 그대로 싣고, 상류가 null 이거나 키를 싣지 않은(옛 Data) 칸은 null 로 키를 유지한다")
    void magazineCellIsRelayedOrNullOnEveryItem() throws Exception {
        String list = LIST.replace("\"arrivedBefore\":true}", "\"arrivedBefore\":true,\"magazineCell\":null}")
                .replace("]}", "," + MAGAZINE_ITEM + "]}");
        DATA.on(DATA_TELESCOPE, request -> ok(list));

        var result = mockMvc.perform(auth(get(TELESCOPE))).andExpect(status().isOk()).andReturn();

        ObjectMapper json = new ObjectMapper();
        var items = json.readTree(result.getResponse().getContentAsString()).path("data").path("items");
        assertThat(items.get(0).has("magazineCell")).as("상류 null").isTrue();
        assertThat(items.get(0).get("magazineCell").isNull()).isTrue();
        assertThat(items.get(1).has("magazineCell")).as("옛 Data — 키 없음").isTrue();
        assertThat(items.get(1).get("magazineCell").isNull()).isTrue();
        assertThat(items.get(2)).isEqualTo(json.readTree(MAGAZINE_ITEM));
    }

    @Test
    @DisplayName("넣기는 201 로 항목과 evicted 를 돌려주고 created 는 공개하지 않는다 — 본문은 {islandId, source} 만 상류로 간다")
    void pinReturnsCreatedItemWithEvictedAndHidesCreatedFlag() throws Exception {
        DATA.on(DATA_PIN, request -> ok("{\"item\":" + PINNED_ITEM + ",\"evicted\":{\"islandId\":\"" + EVICTED
                + "\",\"name\":\"오래된섬\"},\"created\":true}"));

        mockMvc.perform(write(post(PINS), "{\"islandId\":\"" + PINNED + "\",\"source\":\"magazine\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.item.islandId").value(PINNED.toString()))
                .andExpect(jsonPath("$.data.item.slot").value("pinned"))
                .andExpect(jsonPath("$.data.item.pinnedFrom").value("magazine"))
                .andExpect(jsonPath("$.data.item.pinnedAt").value("2026-10-12T05:23:41Z"))
                .andExpect(jsonPath("$.data.evicted.islandId").value(EVICTED.toString()))
                .andExpect(jsonPath("$.data.evicted.name").value("오래된섬"))
                .andExpect(jsonPath("$.data.created").doesNotExist());
        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_PIN).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).as("같은 핀을 다시 넣어도 아무것도 바뀌지 않아 명령 키가 없다").isNull();
        assertThat(new ObjectMapper().readTree(forwarded.body()))
                .isEqualTo(new ObjectMapper().readTree("{\"islandId\":\"" + PINNED + "\",\"source\":\"magazine\"}"));
    }

    @Test
    @DisplayName("잡지 홍보 칸에서 넣으면 promotionId 를 상류로 옮기고, 응답 항목의 magazineCell 을 그대로 싣는다")
    void pinForwardsPromotionIdAndRelaysTheMagazineCell() throws Exception {
        DATA.on(DATA_PIN, request -> ok("{\"item\":" + MAGAZINE_ITEM + ",\"evicted\":null,\"created\":true}"));
        String body = "{\"islandId\":\"" + PINNED + "\",\"source\":\"magazine\",\"promotionId\":\"" + PROMOTION + "\"}";

        var result = mockMvc.perform(write(post(PINS), body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.item.magazineCell.promotionId").value(PROMOTION.toString()))
                .andReturn();

        ObjectMapper json = new ObjectMapper();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data").path("item"))
                .isEqualTo(json.readTree(MAGAZINE_ITEM));
        assertThat(json.readTree(DATA.receivedFor(DATA_PIN).get(0).body())).isEqualTo(json.readTree(body));
    }

    @Test
    @DisplayName("promotionId 가 null 이면 없는 것과 같다 — 상류 본문에 싣지 않고 응답 항목의 magazineCell 은 null 키로 남는다")
    void pinTreatsANullPromotionIdAsAbsent() throws Exception {
        DATA.on(DATA_PIN, request -> ok("{\"item\":" + PINNED_ITEM.replace("}", ",\"magazineCell\":null}")
                + ",\"evicted\":null,\"created\":true}"));

        mockMvc.perform(write(post(PINS),
                        "{\"islandId\":\"" + PINNED + "\",\"source\":\"magazine\",\"promotionId\":null}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.item.magazineCell").hasJsonPath())
                .andExpect(jsonPath("$.data.item.magazineCell").value((Object) null));
        assertThat(new ObjectMapper().readTree(DATA.receivedFor(DATA_PIN).get(0).body()))
                .isEqualTo(new ObjectMapper().readTree("{\"islandId\":\"" + PINNED + "\",\"source\":\"magazine\"}"));
    }

    @Test
    @DisplayName("이미 있던 핀(created=false)은 200 이고 evicted 키는 null 로 항상 있다")
    void pinningAnExistingPinIs200WithNullEvicted() throws Exception {
        DATA.on(DATA_PIN, request -> ok("{\"item\":" + PINNED_ITEM + ",\"evicted\":null,\"created\":false}"));

        mockMvc.perform(write(post(PINS), "{\"islandId\":\"" + PINNED + "\",\"source\":\"observatory\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.item.pinnedFrom").value("magazine"))
                .andExpect(jsonPath("$.data.evicted").hasJsonPath())
                .andExpect(jsonPath("$.data.evicted").value((Object) null))
                .andExpect(jsonPath("$.data.item.magazineCell").hasJsonPath())
                .andExpect(jsonPath("$.data.item.magazineCell").value((Object) null));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "{}|INVALID_REQUEST|islandId",
            "[]|INVALID_REQUEST|",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\"}|INVALID_REQUEST|source",
            "{\"source\":\"magazine\"}|INVALID_REQUEST|islandId",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":\"ad\"}|INVALID_REQUEST|source",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":7}|INVALID_REQUEST|source",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":null}|INVALID_REQUEST|source",
            "{\"islandId\":7,\"source\":\"magazine\"}|INVALID_REQUEST|islandId",
            "{\"islandId\":\"not-a-uuid\",\"source\":\"magazine\"}|INVALID_PARAMETER|islandId",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":\"magazine\",\"userId\":\"x\"}|INVALID_REQUEST|",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":\"magazine\",\"promotionId\":7}|INVALID_REQUEST|promotionId",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":\"magazine\",\"promotionId\":\"not-a-uuid\"}|INVALID_REQUEST|promotionId",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":\"magazine\",\"promotionId\":{}}|INVALID_REQUEST|promotionId",
            "{\"islandId\":\"eeeeeeee-2268-0000-0000-000000000001\",\"source\":\"magazine\",\"promotionId\":null,\"userId\":\"x\"}|INVALID_REQUEST|"})
    @DisplayName("본문이 {islandId, source, promotionId?} 가 아니거나 출처가 magazine·observatory 가 아니거나 promotionId 가 UUID 가 아니면 상류 전에 400 이다")
    void pinRejectsMalformedBodyBeforeUpstream(String body, String code, String field) throws Exception {
        var result = mockMvc.perform(write(post(PINS), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "403,KICKED_CANNOT_REJOIN,403,FORBIDDEN,islandId",
            "409,ALREADY_MEMBER,409,STATE_CONFLICT,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,GROUP_NOT_FOUND,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_PIN_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("넣기의 상류 판정(404·강퇴 403·소속 409)은 정확히 같은 (상태, 코드) 쌍만 기존 공개 코드로 옮긴다")
    void pinMapsDomainFailures(int upstreamStatus, String upstreamCode, int publicStatus, String publicCode,
            String field) throws Exception {
        DATA.on(DATA_PIN, request -> new MockUpstream.Response(upstreamStatus,
                "{\"code\":\"" + upstreamCode + "\",\"message\":\"private detail\"}"));

        var result = mockMvc.perform(write(post(PINS), "{\"islandId\":\"" + PINNED + "\",\"source\":\"magazine\"}"))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            // 요청한 섬이 아닌 항목
            "{\"item\":{ITEM_OTHER},\"evicted\":null,\"created\":true}",
            // 핀 칸이 아닌 항목
            "{\"item\":{ITEM_RANDOM},\"evicted\":null,\"created\":true}",
            // created 가 빠진 응답
            "{\"item\":{ITEM},\"evicted\":null}",
            // evicted 키가 빠진 응답
            "{\"item\":{ITEM},\"created\":true}"})
    @DisplayName("핀 응답의 항목이 요청과 다르거나 필수 키가 빠졌으면 계약 오류다")
    void pinRejectsInconsistentUpstreamResponse(String template) throws Exception {
        String body = template.replace("{ITEM_OTHER}", PINNED_ITEM.replace(PINNED.toString(), NEARBY.toString()))
                .replace("{ITEM_RANDOM}", PINNED_ITEM.replace("\"slot\":\"pinned\"", "\"slot\":\"random\""))
                .replace("{ITEM}", PINNED_ITEM);
        DATA.on(DATA_PIN, request -> ok(body));

        mockMvc.perform(write(post(PINS), "{\"islandId\":\"" + PINNED + "\",\"source\":\"magazine\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("빼기는 200 {deleted:true} 이고 경로 id 가 UUID 가 아니면 상류 전에 400, 상류가 deleted:false 면 계약 오류다")
    void unpinReturnsDeletedTrue() throws Exception {
        DATA.on(DATA_UNPIN, request -> ok("{\"deleted\":true}"));

        mockMvc.perform(auth(delete(PINS + "/" + PINNED)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));
        assertThat(DATA.receivedFor(DATA_UNPIN).get(0).header("X-User-Id")).isEqualTo(USER.toString());
        mockMvc.perform(auth(delete(PINS + "/not-a-uuid"))).andExpect(status().isBadRequest());
        assertThat(DATA.receivedFor(DATA_UNPIN)).hasSize(1);

        DATA.reset();
        DATA.on(DATA_UNPIN, request -> ok("{\"deleted\":false}"));
        mockMvc.perform(auth(delete(PINS + "/" + PINNED)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("빼기의 상류 USER_NOT_FOUND 는 404 USER_NOT_FOUND 다")
    void unpinMapsUserNotFound() throws Exception {
        DATA.on(DATA_UNPIN, request -> new MockUpstream.Response(404,
                "{\"code\":\"USER_NOT_FOUND\",\"message\":\"private detail\"}"));

        mockMvc.perform(auth(delete(PINS + "/" + PINNED)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));
    }

    // ---------------------------------------------------------------- 도구

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    /** 공개 응답 기대값 — {@code magazineCell} 을 모르는 상류 칸에는 공개가 null 키를 싣는다. */
    private static tools.jackson.databind.JsonNode withNullCells(String upstream) {
        var tree = new ObjectMapper().readTree(upstream);
        tree.path("items").forEach(item -> {
            if (!item.has("magazineCell")) {
                ((tools.jackson.databind.node.ObjectNode) item).putNull("magazineCell");
            }
        });
        return tree;
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
