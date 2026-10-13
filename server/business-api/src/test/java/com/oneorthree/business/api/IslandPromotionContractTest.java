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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 잡지 홍보 신청·섬 소식 공개 2종(GROMO-2267)과 고양이 잡지 편집·고치기·꾸미기 재료·신고·홍보 기록판 5종(GROMO-2289)의 계약 — 실제
 * 필터·컨트롤러·TCP 클라이언트로 경계를 본다: 주체·앱 키·본문·{@code limit} 의 모양, 상류 판정의 공개 오류 매핑, 공개
 * 문서의 필드. 섬장·게스트·잔액·신청 창·layout·재료 보유·신고 누적 숨김의 판정과 차감·소식 쓰기는 data-api 의
 * {@code IslandPromotionIntegrationTest} 가 실제 DB 로 본다.
 */
class IslandPromotionContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-2267-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-2267-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-2267-0000-0000-000000000001");
    private static final UUID NEWS = UUID.fromString("01990000-2267-7000-8000-000000000001");
    private static final UUID PROMOTION = UUID.fromString("01990000-2289-7000-8000-000000000001");
    private static final UUID LATEST = UUID.fromString("01990000-2289-7000-8000-000000000002");
    private static final String KEY = "eeeeeeee-2267-4000-8000-000000000001";

    private static final String PUBLIC = "/islands/" + ISLAND;
    private static final String INTERNAL = "/internal/users/" + USER + "/islands/" + ISLAND;
    private static final String DATA_PROMOTE = "POST " + INTERNAL + "/promotions";
    private static final String DATA_NEWS = "GET " + INTERNAL + "/news";
    private static final String DATA_UPDATE = "PUT " + INTERNAL + "/promotions/" + PROMOTION;
    private static final String DATA_EDITOR = "GET " + INTERNAL + "/promotions/editor";
    private static final String DATA_ASSETS = "GET /internal/users/" + USER + "/magazine/assets";
    private static final String DATA_REPORT = "POST " + INTERNAL + "/promotions/" + PROMOTION + "/reports";
    private static final String DATA_RECORDS = "GET " + INTERNAL + "/promotions/records";

    /** Business 가 속을 보지 않는 layout — 모르는 키·중첩까지 그대로 오간다. */
    private static final String LAYOUT = "{\"v\":1,\"frameId\":\"mag.frame-scallop\",\"stickers\":[{\"assetId\":"
            + "\"mag.cat-black-book\",\"x\":0.25,\"y\":0.5,\"scale\":1.2,\"rotation\":-15}],\"tape\":"
            + "\"mag.tape-cream\",\"future\":{\"nested\":[1,2]}}";
    private static final String TEXT = "우리 섬에 놀러 오세요 🐟";
    private static final String REQUEST = "{\"body\":\"" + TEXT + "\",\"layout\":" + LAYOUT + "}";

    private static final String CREATED = "{\"promotionId\":\"" + PROMOTION + "\",\"issueDate\":\"2026-10-15\","
            + "\"feeFish\":60,\"balanceAfter\":40,\"newsId\":\"" + NEWS + "\"}";
    private static final String UPDATED = "{\"promotionId\":\"" + PROMOTION + "\",\"issueDate\":\"2026-10-15\","
            + "\"body\":\"" + TEXT + "\",\"layout\":" + LAYOUT + ",\"updatedAt\":\"2026-10-14T05:00:00Z\"}";
    private static final String WINDOW = "{\"open\":true,\"issueDate\":\"2026-10-15\","
            + "\"opensAt\":\"2026-10-13T22:00:00Z\",\"closesAt\":\"2026-10-14T15:00:00Z\"}";
    private static final String NEXT = "{\"promotionId\":\"" + PROMOTION + "\",\"issueDate\":\"2026-10-15\","
            + "\"body\":\"" + TEXT + "\",\"layout\":" + LAYOUT + ",\"appliedAt\":\"2026-10-14T05:00:00Z\","
            + "\"editable\":true}";
    private static final String LATEST_ISSUE = "{\"promotionId\":\"" + LATEST + "\",\"issueDate\":\"2026-10-12\","
            + "\"body\":\"지난 호\",\"layout\":{\"v\":1}}";
    private static final String ASSETS = "{\"frames\":[{\"assetId\":\"mag.frame-scallop\",\"bundle\":\"free\","
            + "\"owned\":true}],\"stickers\":[{\"assetId\":\"mag.cat-black-book\",\"tab\":\"cat\","
            + "\"bundle\":\"free\",\"owned\":true}],\"tapes\":[{\"assetId\":\"mag.tape-cream\","
            + "\"bundle\":\"season\",\"owned\":false}]}";
    private static final String NEWS_PAGE = "{\"items\":[{\"id\":\"" + NEWS + "\",\"kind\":\"PROMOTION\","
            + "\"body\":\"섬장이 오늘 잡지 홍보에 60마리를 썼어요\",\"createdAt\":\"2026-10-12T05:00:00Z\"},"
            + "{\"id\":\"" + UUID.randomUUID() + "\",\"kind\":\"MAGAZINE_ISSUED\",\"body\":\"모르는 종류도 그대로\","
            + "\"createdAt\":\"2026-10-11T05:00:00Z\"}]}";

    /** 기록판 — 아직 나오지 않은 호는 {@code issueNo} 가 null 이고 키는 남는다. */
    private static final String RECORDS = "{\"items\":[{\"promotionId\":\"" + PROMOTION + "\",\"issueDate\":\"2026-10-15\","
            + "\"issueNo\":null,\"body\":\"" + TEXT + "\",\"status\":\"SCHEDULED\",\"pinned\":0,\"arrived\":0,"
            + "\"joined\":0},{\"promotionId\":\"" + LATEST + "\",\"issueDate\":\"2026-10-12\",\"issueNo\":12,"
            + "\"body\":\"지난 호\",\"status\":\"PUBLISHED\",\"pinned\":3,\"arrived\":1,\"joined\":0}]}";

    // ---------------------------------------------------------------- 신청

    @Test
    @DisplayName("신청은 201 {promotionId, issueDate, feeFish, balanceAfter, newsId} 이고 서명된 주체·앱 키·본문을 상류로 옮긴다 — 공격자 X-User-Id 는 버린다")
    void promoteReturnsCreatedAndForwardsOnlyTheSignedSubjectAndKey() throws Exception {
        DATA.on(DATA_PROMOTE, request -> new MockUpstream.Response(201, CREATED));

        mockMvc.perform(promote().header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.promotionId").value(PROMOTION.toString()))
                .andExpect(jsonPath("$.data.issueDate").value("2026-10-15"))
                .andExpect(jsonPath("$.data.feeFish").value(60))
                .andExpect(jsonPath("$.data.balanceAfter").value(40))
                .andExpect(jsonPath("$.data.newsId").value(NEWS.toString()));

        assertThat(DATA.received()).hasSize(1);
        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_PROMOTE).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertSameJson(forwarded.body(), REQUEST);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-a-uuid", "eeeeeeee-2267-4000-8000-00000000000"})
    @DisplayName("Idempotency-Key 가 없거나 UUID 가 아니면 400 INVALID_IDEMPOTENCY_KEY — 상류를 부르지 않는다")
    void promoteRequiresAUuidCommandKey(String key) throws Exception {
        MockHttpServletRequestBuilder request = json(post(PUBLIC + "/promotions"), REQUEST);
        mockMvc.perform(key.isEmpty() ? request : request.header("Idempotency-Key", key))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("섬 id 가 UUID 가 아니면 상류 전에 400 이다")
    void promoteRejectsANonUuidIsland() throws Exception {
        mockMvc.perform(json(post("/islands/not-a-uuid/promotions"), REQUEST).header("Idempotency-Key", KEY))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "403,NOT_OWNER,403,FORBIDDEN,",
            "403,SOCIAL_LOGIN_REQUIRED,403,SOCIAL_LOGIN_REQUIRED,",
            "409,PROMOTION_ALREADY_REQUESTED_TODAY,409,PROMOTION_ALREADY_REQUESTED_TODAY,",
            "409,INSUFFICIENT_FUNDS,409,INSUFFICIENT_FUNDS,",
            "409,PROMOTION_WINDOW_CLOSED,409,PROMOTION_WINDOW_CLOSED,",
            "409,PROMOTION_PRIVATE_ISLAND,409,PROMOTION_PRIVATE_ISLAND,",
            "422,PROMOTION_TEXT_TOO_LONG,422,PROMOTION_TEXT_TOO_LONG,",
            "400,PROMOTION_LAYOUT_INVALID,400,PROMOTION_LAYOUT_INVALID,",
            "403,PROMOTION_ASSET_NOT_OWNED,403,PROMOTION_ASSET_NOT_OWNED,",
            "400,BANNED_WORD,400,BANNED_WORD,",
            // 잡지 기능 스위치가 꺼져 있다 — 공개 이름 없이 일시 불가로 접는다(앱 공개 5xx 는 전송 400).
            "503,MAGAZINE_NOT_READY,400,SERVICE_UNAVAILABLE,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,NOT_OWNER,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_PROMOTION_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 계약 위반이다")
    void promoteRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_PROMOTE, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(promote())
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{}",
            "[]",
            "\"text\"",
            "{\"layout\":{}}",
            "{\"body\":null,\"layout\":{}}",
            "{\"body\":7,\"layout\":{}}",
            "{\"body\":\"a\"}",
            "{\"body\":\"a\",\"layout\":null}",
            "{\"body\":\"a\",\"layout\":[]}",
            "{\"body\":\"a\",\"layout\":\"{}\"}",
            "{\"body\":\"a\",\"layout\":{},\"userId\":\"x\"}",
            "{not json"})
    @DisplayName("신청 본문이 {body: 문자열, layout: 객체} 가 아니면 400 INVALID_REQUEST — 상류를 부르지 않는다")
    void promoteRejectsAMalformedBodyBeforeUpstream(String body) throws Exception {
        mockMvc.perform(json(post(PUBLIC + "/promotions"), body).header("Idempotency-Key", KEY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "{\"layout\":{}}|body",
            "{\"body\":7,\"layout\":{}}|body",
            "{\"body\":\"a\"}|layout",
            "{\"body\":\"a\",\"layout\":[]}|layout"})
    @DisplayName("빠지거나 타입이 틀린 필드는 error.field 로 가리킨다")
    void malformedFieldIsNamed(String body, String field) throws Exception {
        mockMvc.perform(json(post(PUBLIC + "/promotions"), body).header("Idempotency-Key", KEY))
                .andExpect(jsonPath("$.error.field").value(field));
        mockMvc.perform(json(put(PUBLIC + "/promotions/" + PROMOTION), body))
                .andExpect(jsonPath("$.error.field").value(field));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("글 길이는 Business 가 보지 않는다 — 61자도 그대로 상류에 가고 판정은 Data 의 422 다")
    void promoteLeavesTheTextLimitToData() throws Exception {
        DATA.on(DATA_PROMOTE, request -> error(422, "PROMOTION_TEXT_TOO_LONG"));
        String longText = "가".repeat(61);

        mockMvc.perform(json(post(PUBLIC + "/promotions"), "{\"body\":\"" + longText + "\",\"layout\":{}}")
                        .header("Idempotency-Key", KEY))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("PROMOTION_TEXT_TOO_LONG"))
                .andExpect(jsonPath("$.error.message").value("홍보 글은 60자까지 쓸 수 있어요"));
        assertThat(DATA.receivedFor(DATA_PROMOTE).get(0).body()).contains(longText);
    }

    @Test
    @DisplayName("상류 응답에 필수 필드가 빠지면 성공으로 내보내지 않고 계약 위반으로 접는다")
    void promoteRejectsADriftingUpstreamBody() throws Exception {
        String withoutBalance = "{\"promotionId\":\"" + PROMOTION + "\",\"issueDate\":\"2026-10-15\","
                + "\"feeFish\":60,\"newsId\":\"" + NEWS + "\"}";
        DATA.on(DATA_PROMOTE, request -> new MockUpstream.Response(201, withoutBalance));

        mockMvc.perform(promote())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    // ---------------------------------------------------------------- 고치기

    @Test
    @DisplayName("고치기는 200 {promotionId, issueDate, body, layout, updatedAt} 이고 명령 키 없이 본문을 그대로 상류에 보낸다")
    void updateRelaysTheReplacedPromotionWithoutAKey() throws Exception {
        DATA.on(DATA_UPDATE, request -> ok(UPDATED));

        mockMvc.perform(json(put(PUBLIC + "/promotions/" + PROMOTION), REQUEST).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.promotionId").value(PROMOTION.toString()))
                .andExpect(jsonPath("$.data.issueDate").value("2026-10-15"))
                .andExpect(jsonPath("$.data.body").value(TEXT))
                .andExpect(jsonPath("$.data.layout.frameId").value("mag.frame-scallop"))
                .andExpect(jsonPath("$.data.layout.stickers[0].rotation").value(-15))
                .andExpect(jsonPath("$.data.layout.future.nested[1]").value(2))
                .andExpect(jsonPath("$.data.updatedAt").value("2026-10-14T05:00:00Z"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_UPDATE).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).as("전체 교체 PUT 이라 명령 키가 없다").isNull();
        assertSameJson(forwarded.body(), REQUEST);
    }

    @Test
    @DisplayName("고치기는 앱이 보낸 명령 키를 요구하지도 상류에 옮기지도 않는다")
    void updateIgnoresACommandKey() throws Exception {
        DATA.on(DATA_UPDATE, request -> ok(UPDATED));

        mockMvc.perform(json(put(PUBLIC + "/promotions/" + PROMOTION), REQUEST).header("Idempotency-Key", KEY))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_UPDATE).get(0).header("Idempotency-Key")).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"body\":\"a\",\"layout\":[]}", "{\"body\":1,\"layout\":{}}"})
    @DisplayName("고치기 본문도 {body: 문자열, layout: 객체} 가 아니면 400 INVALID_REQUEST — 상류를 부르지 않는다")
    void updateRejectsAMalformedBodyBeforeUpstream(String body) throws Exception {
        mockMvc.perform(json(put(PUBLIC + "/promotions/" + PROMOTION), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("홍보 id 가 UUID 가 아니면 상류 전에 400 이다")
    void updateRejectsANonUuidPromotion() throws Exception {
        mockMvc.perform(json(put(PUBLIC + "/promotions/not-a-uuid"), REQUEST))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("promotionId"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "409,PROMOTION_LOCKED,409,PROMOTION_LOCKED,",
            "404,PROMOTION_NOT_FOUND,404,PROMOTION_NOT_FOUND,",
            "400,PROMOTION_LAYOUT_INVALID,400,PROMOTION_LAYOUT_INVALID,",
            "403,PROMOTION_ASSET_NOT_OWNED,403,PROMOTION_ASSET_NOT_OWNED,",
            "422,PROMOTION_TEXT_TOO_LONG,422,PROMOTION_TEXT_TOO_LONG,",
            "400,BANNED_WORD,400,BANNED_WORD,",
            "403,NOT_OWNER,403,FORBIDDEN,",
            "403,SOCIAL_LOGIN_REQUIRED,403,SOCIAL_LOGIN_REQUIRED,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "503,MAGAZINE_NOT_READY,400,SERVICE_UNAVAILABLE,",
            "409,PROMOTION_NOT_FOUND,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("고치기도 정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮긴다")
    void updateRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_UPDATE, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(json(put(PUBLIC + "/promotions/" + PROMOTION), REQUEST))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.hits(DATA_UPDATE)).as("명령 키 없는 PUT 은 재시도하지 않는다").isEqualTo(1);
    }

    // ---------------------------------------------------------------- 편집 화면

    @Test
    @DisplayName("편집 화면은 window·next·latest·feeFish·balance·privateIsland 를 그대로 싣는다")
    void editorRelaysTheScreen() throws Exception {
        DATA.on(DATA_EDITOR, request -> ok("{\"window\":" + WINDOW + ",\"next\":" + NEXT + ",\"latest\":"
                + LATEST_ISSUE + ",\"feeFish\":60,\"balance\":1234,\"privateIsland\":false}"));

        mockMvc.perform(auth(get(PUBLIC + "/promotions/editor")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.window.open").value(true))
                .andExpect(jsonPath("$.data.window.issueDate").value("2026-10-15"))
                .andExpect(jsonPath("$.data.window.opensAt").value("2026-10-13T22:00:00Z"))
                .andExpect(jsonPath("$.data.window.closesAt").value("2026-10-14T15:00:00Z"))
                .andExpect(jsonPath("$.data.next.promotionId").value(PROMOTION.toString()))
                .andExpect(jsonPath("$.data.next.body").value(TEXT))
                .andExpect(jsonPath("$.data.next.layout.stickers[0].assetId").value("mag.cat-black-book"))
                .andExpect(jsonPath("$.data.next.appliedAt").value("2026-10-14T05:00:00Z"))
                .andExpect(jsonPath("$.data.next.editable").value(true))
                .andExpect(jsonPath("$.data.latest.promotionId").value(LATEST.toString()))
                .andExpect(jsonPath("$.data.latest.issueDate").value("2026-10-12"))
                .andExpect(jsonPath("$.data.latest.layout.v").value(1))
                .andExpect(jsonPath("$.data.feeFish").value(60))
                .andExpect(jsonPath("$.data.balance").value(1234))
                .andExpect(jsonPath("$.data.privateIsland").value(false));
        assertThat(DATA.receivedFor(DATA_EDITOR).get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("next·latest 가 없으면 null 로 키를 유지한다")
    void editorKeepsNullIssues() throws Exception {
        DATA.on(DATA_EDITOR, request -> ok("{\"window\":" + WINDOW + ",\"next\":null,\"latest\":null,"
                + "\"feeFish\":60,\"balance\":0,\"privateIsland\":true}"));

        mockMvc.perform(auth(get(PUBLIC + "/promotions/editor")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.next").hasJsonPath())
                .andExpect(jsonPath("$.data.next").value((Object) null))
                .andExpect(jsonPath("$.data.latest").hasJsonPath())
                .andExpect(jsonPath("$.data.latest").value((Object) null))
                .andExpect(jsonPath("$.data.privateIsland").value(true));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            // next 키 자체가 빠졌다 — null 과 다르다.
            "{\"window\":{w},\"latest\":null,\"feeFish\":60,\"balance\":0,\"privateIsland\":false}",
            "{\"window\":null,\"next\":null,\"latest\":null,\"feeFish\":60,\"balance\":0,\"privateIsland\":false}",
            // layout 이 객체가 아니다.
            "{\"window\":{w},\"next\":null,\"latest\":{\"promotionId\":\"01990000-2289-7000-8000-000000000002\","
                    + "\"issueDate\":\"2026-10-12\",\"body\":\"x\",\"layout\":[]},\"feeFish\":60,\"balance\":0,"
                    + "\"privateIsland\":false}"})
    @DisplayName("편집 화면 응답이 어긋나면 계약 위반으로 접는다")
    void editorRejectsADriftingUpstreamBody(String body) throws Exception {
        DATA.on(DATA_EDITOR, request -> ok(body.replace("{w}", WINDOW)));

        mockMvc.perform(auth(get(PUBLIC + "/promotions/editor")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @ParameterizedTest
    @CsvSource({
            "403,NOT_OWNER,403,FORBIDDEN,",
            "403,SOCIAL_LOGIN_REQUIRED,403,SOCIAL_LOGIN_REQUIRED,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,"})
    @DisplayName("편집 화면은 섬장 아님·게스트·없는 섬의 판정을 공개 오류로 옮긴다")
    void editorRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_EDITOR, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(auth(get(PUBLIC + "/promotions/editor")))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    // ---------------------------------------------------------------- 꾸미기 재료

    @Test
    @DisplayName("꾸미기 재료는 frames·stickers·tapes 를 그대로 싣는다 — 게스트 세션도 읽는다")
    void assetsRelayTheInventory() throws Exception {
        DATA.on(DATA_ASSETS, request -> ok(ASSETS));

        mockMvc.perform(auth(get("/me/magazine/assets")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.frames[0].assetId").value("mag.frame-scallop"))
                .andExpect(jsonPath("$.data.frames[0].bundle").value("free"))
                .andExpect(jsonPath("$.data.frames[0].owned").value(true))
                .andExpect(jsonPath("$.data.stickers[0].assetId").value("mag.cat-black-book"))
                .andExpect(jsonPath("$.data.stickers[0].tab").value("cat"))
                .andExpect(jsonPath("$.data.stickers[0].bundle").value("free"))
                .andExpect(jsonPath("$.data.stickers[0].owned").value(true))
                .andExpect(jsonPath("$.data.tapes[0].assetId").value("mag.tape-cream"))
                .andExpect(jsonPath("$.data.tapes[0].bundle").value("season"))
                .andExpect(jsonPath("$.data.tapes[0].owned").value(false));
        assertThat(DATA.receivedFor(DATA_ASSETS).get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("꾸미기 재료는 멱등 GET 이라 상류 일시 실패를 재시도한다")
    void assetsRetryATransientFailure() throws Exception {
        DATA.failThenSucceed(DATA_ASSETS, 1, 503, ASSETS);

        mockMvc.perform(auth(get("/me/magazine/assets")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.frames[0].assetId").value("mag.frame-scallop"));
        assertThat(DATA.hits(DATA_ASSETS)).isEqualTo(2);
    }

    @Test
    @DisplayName("꾸미기 재료의 사용자 없음은 USER_NOT_FOUND 로 옮기고, 필드가 빠지면 계약 위반이다")
    void assetsRelayUserNotFoundAndRejectDrift() throws Exception {
        DATA.on(DATA_ASSETS, request -> error(404, "USER_NOT_FOUND"));
        mockMvc.perform(auth(get("/me/magazine/assets")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));

        DATA.on(DATA_ASSETS, request -> ok("{\"frames\":[],\"stickers\":[{\"assetId\":\"a\",\"bundle\":\"free\","
                + "\"owned\":true}],\"tapes\":[]}"));
        mockMvc.perform(auth(get("/me/magazine/assets")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 소식

    @Test
    @DisplayName("소식은 상류 items 를 그대로 싣고 모르는 kind 도 막지 않으며, limit 을 생략하면 20 을 상류에 보낸다")
    void newsRelaysItemsAndDefaultsTheLimit() throws Exception {
        DATA.on(DATA_NEWS, request -> ok(NEWS_PAGE));

        mockMvc.perform(auth(get(PUBLIC + "/news")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(2))
                .andExpect(jsonPath("$.data.items[0].id").value(NEWS.toString()))
                .andExpect(jsonPath("$.data.items[0].kind").value("PROMOTION"))
                .andExpect(jsonPath("$.data.items[0].body").value("섬장이 오늘 잡지 홍보에 60마리를 썼어요"))
                .andExpect(jsonPath("$.data.items[0].createdAt").value("2026-10-12T05:00:00Z"))
                .andExpect(jsonPath("$.data.items[1].kind").value("MAGAZINE_ISSUED"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_NEWS).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.query()).isEqualTo("limit=20");
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "20", "50"})
    @DisplayName("limit 1~50 은 그대로 상류에 간다")
    void newsForwardsAnInRangeLimit(String limit) throws Exception {
        DATA.on(DATA_NEWS, request -> ok("{\"items\":[]}"));

        mockMvc.perform(auth(get(PUBLIC + "/news?limit=" + limit)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty());
        assertThat(DATA.receivedFor(DATA_NEWS).get(0).query()).isEqualTo("limit=" + limit);
    }

    @ParameterizedTest
    @CsvSource({"0,422,OUT_OF_RANGE", "51,422,OUT_OF_RANGE", "-1,422,OUT_OF_RANGE", "abc,400,INVALID_PARAMETER",
            "1.5,400,INVALID_PARAMETER", "'',400,INVALID_PARAMETER"})
    @DisplayName("limit 이 정수가 아니면 400, 1~50 밖이면 422 — 상류를 부르지 않는다")
    void newsRejectsABadLimit(String limit, int status, String code) throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/news?limit=" + limit)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("limit 을 두 번 보내면 400 INVALID_PARAMETER 다")
    void newsRejectsARepeatedLimit() throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/news?limit=1&limit=2")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "400,INVALID_PAGE_REQUEST,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("소식은 비주민·없는 섬의 판정을 공개 오류로 옮기고 그 밖은 계약 위반이다")
    void newsRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_NEWS, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(auth(get(PUBLIC + "/news")))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    // ---------------------------------------------------------------- 신고

    @ParameterizedTest
    @CsvSource({"true,201", "false,200"})
    @DisplayName("신고는 Data 의 새 신고(201)·이미 한 신고(200)를 그대로 옮기고 created 는 공개하지 않는다 — 본문은 {reason} 만 명령 키 없이 간다")
    void reportRelaysCreatedOrExisting(boolean created, int status) throws Exception {
        DATA.on(DATA_REPORT, request -> new MockUpstream.Response(created ? 201 : 200,
                "{\"reported\":true,\"created\":" + created + "}"));

        mockMvc.perform(json(post(PUBLIC + "/promotions/" + PROMOTION + "/reports"), "{\"reason\":\"SPAM_FRAUD\"}")
                        .header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.data.reported").value(true))
                .andExpect(jsonPath("$.data.created").doesNotExist());

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_REPORT).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).isNull();
        assertSameJson(forwarded.body(), "{\"reason\":\"SPAM_FRAUD\"}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"HARASSMENT", "HATE", "SPAM_FRAUD", "SEXUAL", "CHILD_SAFETY", "THREAT",
        "PRIVACY_IMPERSONATION", "OTHER"})
    @DisplayName("신고 사유 8개는 모두 그대로 상류에 간다")
    void reportAcceptsEveryReason(String reason) throws Exception {
        DATA.on(DATA_REPORT, request -> new MockUpstream.Response(201, "{\"reported\":true,\"created\":true}"));

        mockMvc.perform(json(post(PUBLIC + "/promotions/" + PROMOTION + "/reports"), "{\"reason\":\"" + reason + "\"}"))
                .andExpect(status().isCreated());
        assertSameJson(DATA.receivedFor(DATA_REPORT).get(0).body(), "{\"reason\":\"" + reason + "\"}");
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "{}|reason",
            "[]|",
            "{\"reason\":null}|reason",
            "{\"reason\":7}|reason",
            "{\"reason\":\"ABUSE\"}|reason",
            "{\"reason\":\"spam_fraud\"}|reason",
            "{\"reason\":\"OTHER\",\"detail\":\"x\"}|",
            "{\"reason\":\"OTHER\",\"userId\":\"x\"}|"})
    @DisplayName("신고 본문이 정확히 {reason: 사유 8개 중 하나} 가 아니면 400 INVALID_REQUEST — 상류를 부르지 않는다")
    void reportRejectsAMalformedBodyBeforeUpstream(String body, String field) throws Exception {
        var result = mockMvc.perform(json(post(PUBLIC + "/promotions/" + PROMOTION + "/reports"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        if (field == null) {
            result.andExpect(jsonPath("$.error.field").doesNotExist());
        } else {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"/islands/not-a-uuid/promotions/01990000-2289-7000-8000-000000000001/reports,islandId",
        "/islands/cccccccc-2267-0000-0000-000000000001/promotions/not-a-uuid/reports,promotionId"})
    @DisplayName("신고 경로의 섬·홍보 id 가 UUID 가 아니면 상류 전에 400 이다")
    void reportRejectsNonUuidPathIds(String path, String field) throws Exception {
        mockMvc.perform(json(post(path), "{\"reason\":\"OTHER\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value(field));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "403,SOCIAL_LOGIN_REQUIRED,403,SOCIAL_LOGIN_REQUIRED,",
            "404,PROMOTION_NOT_FOUND,404,PROMOTION_NOT_FOUND,",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "409,PROMOTION_NOT_FOUND,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_REPORT_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("신고도 정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 재시도하지 않는다")
    void reportRelaysDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_REPORT, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(json(post(PUBLIC + "/promotions/" + PROMOTION + "/reports"),
                        "{\"reason\":\"OTHER\"}"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.data").doesNotExist());
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
        assertThat(DATA.hits(DATA_REPORT)).as("명령 키 없는 POST 는 재시도하지 않는다").isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"reported\":false,\"created\":true}", "{\"reported\":true}", "{\"created\":true}"})
    @DisplayName("신고 응답이 reported:true 가 아니거나 created 가 빠지면 계약 위반이다")
    void reportRejectsADriftingUpstreamBody(String body) throws Exception {
        DATA.on(DATA_REPORT, request -> new MockUpstream.Response(201, body));

        mockMvc.perform(json(post(PUBLIC + "/promotions/" + PROMOTION + "/reports"), "{\"reason\":\"OTHER\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 홍보 기록판

    @Test
    @DisplayName("기록판은 상류 items 를 그대로 싣고 null issueNo 의 키를 유지하며, limit 을 생략하면 20 을 상류에 보낸다")
    void recordsRelayItemsAndDefaultTheLimit() throws Exception {
        DATA.on(DATA_RECORDS, request -> ok(RECORDS));

        var result = mockMvc.perform(auth(get(PUBLIC + "/promotions/records")).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].issueNo").hasJsonPath())
                .andExpect(jsonPath("$.data.items[0].issueNo").value((Object) null))
                .andReturn();
        var mapper = new tools.jackson.databind.ObjectMapper();
        assertThat(mapper.readTree(result.getResponse().getContentAsString()).path("data"))
                .isEqualTo(mapper.readTree(RECORDS));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_RECORDS).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.query()).isEqualTo("limit=20");
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "50"})
    @DisplayName("기록판 limit 1~50 은 그대로 상류에 간다")
    void recordsForwardAnInRangeLimit(String limit) throws Exception {
        DATA.on(DATA_RECORDS, request -> ok("{\"items\":[]}"));

        mockMvc.perform(auth(get(PUBLIC + "/promotions/records?limit=" + limit)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty());
        assertThat(DATA.receivedFor(DATA_RECORDS).get(0).query()).isEqualTo("limit=" + limit);
    }

    @ParameterizedTest
    @CsvSource({"0,422,OUT_OF_RANGE", "51,422,OUT_OF_RANGE", "abc,400,INVALID_PARAMETER", "1.5,400,INVALID_PARAMETER",
        "'1&limit=2',400,INVALID_PARAMETER"})
    @DisplayName("기록판 limit 이 정수가 아니거나 두 번이면 400, 1~50 밖이면 422 — 상류를 부르지 않는다")
    void recordsRejectABadLimit(String limit, int status, String code) throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/promotions/records?limit=" + limit)))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("기록판은 멱등 GET 이라 상류 일시 실패를 재시도한다")
    void recordsRetryATransientFailure() throws Exception {
        DATA.failThenSucceed(DATA_RECORDS, 1, 503, RECORDS);

        mockMvc.perform(auth(get(PUBLIC + "/promotions/records")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[1].issueNo").value(12));
        assertThat(DATA.hits(DATA_RECORDS)).isEqualTo(2);
    }

    @ParameterizedTest
    @CsvSource({
            "403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,MEMBER_ONLY,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("기록판은 비주민·없는 섬의 판정을 공개 오류로 옮기고 그 밖은 계약 위반이다")
    void recordsRelayDataVerdictsAsPublicErrors(int upstreamStatus, String upstreamCode, int status, String code,
            String field) throws Exception {
        DATA.on(DATA_RECORDS, request -> error(upstreamStatus, upstreamCode));

        var result = mockMvc.perform(auth(get(PUBLIC + "/promotions/records")))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.error.code").value(code));
        if (field != null) {
            result.andExpect(jsonPath("$.error.field").value(field));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"issueNo 누락", "status:null", "items:[null]"})
    @DisplayName("기록판 응답의 필수 키 누락·null 은 계약 위반이다")
    void recordsRejectADriftingUpstreamBody(String shape) throws Exception {
        String body = switch (shape) {
            case "issueNo 누락" -> RECORDS.replace("\"issueNo\":null,", "");
            case "status:null" -> RECORDS.replace("\"status\":\"SCHEDULED\"", "\"status\":null");
            case "items:[null]" -> "{\"items\":[null]}";
            default -> throw new IllegalArgumentException(shape);
        };
        assertThat(body).isNotEqualTo(RECORDS);
        DATA.on(DATA_RECORDS, request -> ok(body));

        mockMvc.perform(auth(get(PUBLIC + "/promotions/records")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 공개 문서

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/islands/{islandId}/promotions|post|201||promotionId issueDate feeFish balanceAfter newsId|promotionId issueDate feeFish balanceAfter newsId",
            "/islands/{islandId}/promotions/{promotionId}|put|200||promotionId issueDate body layout updatedAt|promotionId issueDate body layout updatedAt",
            "/islands/{islandId}/promotions/editor|get|200||window next latest feeFish balance privateIsland|window next latest feeFish balance privateIsland",
            "/islands/{islandId}/promotions/editor|get|200|window|open issueDate opensAt closesAt|open issueDate opensAt closesAt",
            "/islands/{islandId}/promotions/editor|get|200|next|promotionId issueDate body layout appliedAt editable|promotionId issueDate body layout appliedAt editable",
            "/islands/{islandId}/promotions/editor|get|200|latest|promotionId issueDate body layout|promotionId issueDate body layout",
            "/me/magazine/assets|get|200||frames stickers tapes|frames stickers tapes",
            "/me/magazine/assets|get|200|frames|assetId bundle owned|assetId bundle owned",
            "/me/magazine/assets|get|200|stickers|assetId tab bundle owned|assetId tab bundle owned",
            "/me/magazine/assets|get|200|tapes|assetId bundle owned|assetId bundle owned",
            "/islands/{islandId}/news|get|200||items|items",
            "/islands/{islandId}/news|get|200|items|id kind body createdAt|id kind body createdAt",
            "/islands/{islandId}/promotions/{promotionId}/reports|post|200||reported|reported",
            "/islands/{islandId}/promotions/records|get|200||items|items",
            "/islands/{islandId}/promotions/records|get|200|items|promotionId issueDate issueNo body status pinned arrived joined|promotionId issueDate issueNo body status pinned arrived joined"})
    @DisplayName("공개 문서가 각 경로의 응답 필드와 필수 여부를 그대로 담는다")
    void publicDocumentationPreservesFields(String path, String method, String responseStatus, String nested,
            String fields, String requiredFields) throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path(path).path(method).path("responses").path(responseStatus)
                .path("content");
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
        assertThat(required).containsExactlyInAnyOrder(requiredFields.split(" "));
    }

    @ParameterizedTest
    @ValueSource(strings = {"IslandPromotionUpdated", "IslandPromotionNext", "IslandPromotionLatest"})
    @DisplayName("공개 문서의 layout 은 문자열이 아니라 JSON 객체다")
    void publicDocumentationDescribesLayoutAsAnObject(String schema) throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        assertThat(document.at("/components/schemas/" + schema + "/properties/layout/type").asText())
                .isEqualTo("object");
    }

    // ---------------------------------------------------------------- 도구

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return auth(request).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockHttpServletRequestBuilder promote() {
        return json(post(PUBLIC + "/promotions"), REQUEST).header("Idempotency-Key", KEY);
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
