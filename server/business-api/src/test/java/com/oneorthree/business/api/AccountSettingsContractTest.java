package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 등록 필터·서명 검증·MVC·HTTP client를 사용한다. 상류만 계약 HTTP 서버로 대체한다. */
class AccountSettingsContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    private static final String KEY = "cccccccc-0000-5000-8000-000000000001";
    private static final String COMMAND = "dddddddd-0000-7000-8000-000000000001";
    private static final String DATA_SNAPSHOT = "POST /internal/users/" + USER + "/notification-settings-snapshot";
    private static final String DATA_PATCH = "PATCH /internal/users/" + USER + "/notification-settings-commands";
    private static final String INITIALIZE = "POST /internal/users/" + USER + "/notification-settings/initialized";
    private static final String APPLY = "PATCH /internal/users/" + USER + "/notification-settings";
    private static final String DELIVERED = "POST /internal/outbox-commands/" + COMMAND + "/delivered";

    @Test
    void readsNotificationTruthAfterAuthenticatedDataSnapshot() throws Exception {
        List<String> order = new CopyOnWriteArrayList<>();
        DATA.on(DATA_SNAPSHOT, request -> {
            order.add("snapshot");
            return ok(snapshot());
        });
        NOTI.on(INITIALIZE, request -> {
            order.add("notification");
            return ok(settings(false));
        });
        mockMvc.perform(auth(get("/me/settings")).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.notifications").value(false))
                .andExpect(jsonPath("$.data.soundEnabled").doesNotExist())
                .andExpect(jsonPath("$.notifications").doesNotExist());
        assertThat(order).containsExactly("snapshot", "notification");
        var check = DATA.received().get(0);
        assertThat(check.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(check.body()).contains(SESSION.toString(), "\"authGeneration\":3");
        assertThat(NOTI.received().get(0).body())
                .contains("\"version\":7", "\"notificationEnabled\":true", "\"nightEndTime\":null");
        assertThat(NOTI.received().get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    void writesDurablyThenAppliesOriginalPatchAndOnlyThenAcknowledges() throws Exception {
        List<String> order = new CopyOnWriteArrayList<>();
        DATA.on(DATA_PATCH, request -> {
            order.add("receipt");
            return ok(command(false));
        });
        NOTI.on(APPLY, request -> {
            order.add("apply");
            return ok("{\"applied\":true}");
        });
        DATA.on(DELIVERED, request -> {
            order.add("delivered");
            return ok(null);
        });
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.notifications").value(false));
        assertThat(order).containsExactly("receipt", "apply", "delivered");
        assertThat(DATA.receivedFor(DATA_PATCH).get(0).header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(DATA.receivedFor(DATA_PATCH).get(0).body())
                .contains("\"notifications\":false", SESSION.toString(), "\"authGeneration\":3");
        var sent = NOTI.receivedFor(APPLY).get(0);
        assertThat(sent.query()).isEqualTo("version=8");
        assertThat(sent.header("Idempotency-Key")).isEqualTo(COMMAND);
        assertThat(sent.body()).contains("\"mask\":[\"notificationEnabled\"]",
                "\"patch\":{\"notificationEnabled\":false}", "\"baseline\"", "\"authGeneration\":3");
        assertThat(sent.body()).doesNotContain("sessionId", "result", "commandId");
        assertThat(DATA.hits(DATA_SNAPSHOT)).isZero();
    }

    @Test
    void rollingProviderResponseExtensionsAreIgnoredAndNeverForwardedAsCommands() throws Exception {
        DATA.on(DATA_SNAPSHOT, request -> ok(snapshot().replace("{", "{\"futureField\":true,")));
        NOTI.on(INITIALIZE, request -> {
            assertThat(request.body()).doesNotContain("futureField");
            return ok(settings(false).replace("{", "{\"futureField\":true,"));
        });
        mockMvc.perform(auth(get("/me/settings")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.notifications").value(false));
        DATA.on(DATA_PATCH, request -> ok(command(false).replace("{", "{\"futureField\":true,")));
        NOTI.on(APPLY, request -> {
            assertThat(request.body()).doesNotContain("futureField");
            return ok("{\"applied\":true,\"futureField\":true}");
        });
        DATA.on(DELIVERED, request -> ok(null));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.notifications").value(false));
        assertThat(DATA.hits(DELIVERED)).isEqualTo(1);
    }

    @Test
    void applyFailureKeepsFailureThenSameKeyRecoversOriginalResult() throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false)));
        AtomicBoolean unavailable = new AtomicBoolean(true);
        NOTI.on(APPLY, request -> unavailable.get()
                ? new MockUpstream.Response(503, "{}") : ok("{\"applied\":true}"));
        DATA.on(DELIVERED, request -> ok(null));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.retryable").value(true));
        assertThat(DATA.hits(DELIVERED)).isZero();
        unavailable.set(false);
        // 현재 정본이 true여도 PATCH 재생의 원 결과는 false다. GET을 호출하면 아래가 잡는다.
        NOTI.on(INITIALIZE, request -> ok(settings(true)));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.notifications").value(false));
        assertThat(DATA.receivedFor(DATA_PATCH)).allSatisfy(r ->
                assertThat(r.header("Idempotency-Key")).isEqualTo(KEY));
        assertThat(NOTI.receivedFor(APPLY)).allSatisfy(r ->
                assertThat(r.header("Idempotency-Key")).isEqualTo(COMMAND));
        assertThat(NOTI.hits(INITIALIZE)).isZero();
    }

    @Test
    void onlyCompletionMarkerFailureCanBeIgnored() throws Exception {
        successfulPatch();
        DATA.on(DELIVERED, request -> new MockUpstream.Response(409,
                "{\"code\":\"DELIVERY_LEASE_CHANGED\",\"message\":\"changed\"}"));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.notifications").value(false));
        assertThat(DATA.hits(DELIVERED)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"notifications\":null}", "{\"notifications\":1}",
            "{\"notifications\":\"false\"}", "{\"notifications\":false,\"soundEnabled\":true}"})
    void rejectsMalformedPublicInputBeforeUpstream(String body) throws Exception {
        mockMvc.perform(write(body)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
        assertThat(NOTI.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"bad", "", "cccccccc-0000-5000-8000-000000000001 "})
    void rejectsInvalidKeys(String key) throws Exception {
        mockMvc.perform(auth(patch("/me/settings")).contentType(MediaType.APPLICATION_JSON)
                        .header("Idempotency-Key", key).content("{\"notifications\":false}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void requiresExactlyOneKeyAndDoesNotGenerateIt() throws Exception {
        for (boolean duplicate : List.of(false, true)) {
            var request = auth(patch("/me/settings")).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"notifications\":false}");
            if (duplicate) {
                request.header("Idempotency-Key", KEY, KEY);
            }
            mockMvc.perform(request).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        }
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void rejectsMissingAndWronglyTypedSignedSessionClaimsWithoutLegacyFallback() throws Exception {
        List<String> tokens = List.of(Tokens.access(USER), Tokens.accessWithGeneration(USER, 3),
                token(Map.of("sid", SESSION.toString())), token(Map.of("sid", SESSION.toString(), "gen", 3.5)),
                token(Map.of("sid", SESSION.toString(), "gen", "3")),
                token(Map.of("sid", SESSION.toString(), "gen", -1)), token(Map.of("sid", "1-2-3-4-5", "gen", 3)),
                Tokens.refresh(USER), Tokens.signedWithOtherKey(USER));
        for (String value : tokens) {
            mockMvc.perform(get("/me/settings").header("Authorization", "Bearer " + value))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
            mockMvc.perform(patch("/me/settings").header("Authorization", "Bearer " + value)
                            .header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"notifications\":false}"))
                    .andExpect(status().isUnauthorized());
        }
        assertThat(DATA.received()).isEmpty();
        assertThat(NOTI.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"403,SESSION_NOT_ACTIVE,401,UNAUTHORIZED", "404,USER_NOT_FOUND,404,USER_NOT_FOUND",
            "401,SESSION_NOT_ACTIVE,502,UPSTREAM_AUTH_FAILED", "409,SESSION_NOT_ACTIVE,502,UPSTREAM_CONTRACT_ERROR"})
    void mapsDataSessionErrorOnlyAtExactStatus(int upstream, String code, int expected, String publicCode)
            throws Exception {
        DATA.on(DATA_SNAPSHOT, request -> new MockUpstream.Response(upstream,
                "{\"code\":\"" + code + "\",\"message\":\"internal detail\"}"));
        mockMvc.perform(auth(get("/me/settings"))).andExpect(status().is(expected))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
        assertThat(NOTI.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"STALE_AUTH_GENERATION,401,UNAUTHORIZED", "MIGRATION_NOT_READY,503,SERVICE_UNAVAILABLE",
            "SETTINGS_NOT_INITIALIZED,502,UPSTREAM_CONTRACT_ERROR"})
    void mapsNotificationFenceErrorsWithoutFinishingReceipt(String code, int expected, String publicCode)
            throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false)));
        NOTI.on(APPLY, request -> new MockUpstream.Response(409,
                "{\"code\":\"" + code + "\",\"message\":\"private\"}"));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().is(expected)).andExpect(jsonPath("$.error.code").value(publicCode));
        assertThat(DATA.hits(DELIVERED)).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "{\"applied\":false}", "{\"applied\":\"true\"}"})
    void requiresActualApplicationAcknowledgement(String response) throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false)));
        NOTI.on(APPLY, request -> ok(response));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        assertThat(DATA.hits(DELIVERED)).isZero();
    }

    @Test
    void validatesDataResponseBeforeAnySatelliteMutation() throws Exception {
        List<String> invalid = List.of(command(false).replace("\"version\":8", "\"version\":8.5"),
                command(true), command(false).replace("\"notificationEnabled\":false", "\"notificationEnabled\":null"),
                command(false).replace("\"mask\":[\"notificationEnabled\"]", "\"mask\":[\"soundEnabled\"]"));
        for (String response : invalid) {
            DATA.on(DATA_PATCH, request -> ok(response));
            mockMvc.perform(write("{\"notifications\":false}"))
                    .andExpect(status().isBadGateway())
                    .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        }
        assertThat(NOTI.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-a-uuid", "1-1-1-1-1", "dddddddd-0000-7000-8000-000000000002"})
    void invalidOrMismatchedEventIdCannotApplyOrCloseAnyOutboxCommand(String eventId) throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false).replace(
                "\"eventId\":\"" + COMMAND + "\"", "\"eventId\":\"" + eventId + "\"")));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        assertThat(NOTI.received()).isEmpty();
        assertThat(DATA.received()).hasSize(1);
        assertThat(DATA.hits(DATA_PATCH)).isEqualTo(1);
        assertThat(DATA.hits(DELIVERED)).isZero();
    }

    @Test
    void missingNullOrNumericEventIdCannotApplyOrAcknowledge() throws Exception {
        String field = "\"eventId\":\"" + COMMAND + "\"";
        for (String body : List.of(command(false).replace(field + ",", ""),
                command(false).replace(field, "\"eventId\":null"),
                command(false).replace(field, "\"eventId\":1"))) {
            DATA.on(DATA_PATCH, request -> ok(body));
            mockMvc.perform(write("{\"notifications\":false}"))
                    .andExpect(status().isBadGateway())
                    .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        }
        assertThat(NOTI.received()).isEmpty();
        assertThat(DATA.received()).hasSize(3);
        assertThat(DATA.hits(DATA_PATCH)).isEqualTo(3);
        assertThat(DATA.hits(DELIVERED)).isZero();
    }

    @Test
    void equivalentUuidCasingWithResponseExtensionsStillAppliesAndAcknowledgesOriginalCommand() throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false).replace(
                "\"eventId\":\"" + COMMAND + "\"",
                "\"eventId\":\"" + COMMAND.toUpperCase(java.util.Locale.ROOT) + "\"")
                .replace("{", "{\"futureField\":true,")));
        NOTI.on(APPLY, request -> ok("{\"applied\":true,\"futureField\":true}"));
        DATA.on(DELIVERED, request -> ok(null));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.notifications").value(false));
        assertThat(NOTI.received()).hasSize(1);
        assertThat(NOTI.receivedFor(APPLY).get(0).header("Idempotency-Key")).isEqualTo(COMMAND);
        assertThat(NOTI.receivedFor(APPLY).get(0).body()).doesNotContain("futureField");
        assertThat(DATA.hits(DELIVERED)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(longs = {4, 9007199254740991L})
    void futureGenerationCannotReachNotificationOrAcknowledgeCommand(long generation) throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false).replace(
                "\"authGeneration\":3", "\"authGeneration\":" + generation)));
        // 수신자가 미래 세대를 받아도 되는 상태여도 Business가 원 서명 자격과 대조해 차단해야 한다.
        NOTI.on(APPLY, request -> ok("{\"applied\":true}"));
        DATA.on(DELIVERED, request -> ok(null));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.error.retryable").value(false))
                .andExpect(jsonPath("$.data").doesNotExist());
        assertThat(DATA.hits(DATA_PATCH)).isEqualTo(1);
        assertThat(DATA.receivedFor(DATA_PATCH).get(0).body()).contains("\"authGeneration\":3");
        assertThat(NOTI.received()).isEmpty();
        assertThat(DATA.hits(DELIVERED)).isZero();
    }

    @ParameterizedTest
    @ValueSource(longs = {0, 2, 3})
    void originalPastOrCurrentGenerationRemainsUnchangedWhenNotificationAccepts(long generation) throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false).replace(
                "\"authGeneration\":3", "\"authGeneration\":" + generation)));
        NOTI.on(APPLY, request -> ok("{\"applied\":true}"));
        DATA.on(DELIVERED, request -> ok(null));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.notifications").value(false));
        assertThat(DATA.receivedFor(DATA_PATCH).get(0).body()).contains("\"authGeneration\":3");
        assertThat(NOTI.received()).hasSize(1);
        assertThat(NOTI.receivedFor(APPLY).get(0).body()).contains("\"authGeneration\":" + generation);
        assertThat(NOTI.receivedFor(APPLY).get(0).header("Idempotency-Key")).isEqualTo(COMMAND);
        assertThat(DATA.hits(DELIVERED)).isEqualTo(1);
        assertThat(DATA.hits(DATA_SNAPSHOT)).isZero();
    }

    @Test
    void replayPreservesOriginalGenerationInsteadOfUpgradingItToCurrentClaims() throws Exception {
        DATA.on(DATA_PATCH, request -> ok(command(false).replace("\"authGeneration\":3", "\"authGeneration\":2")));
        NOTI.on(APPLY, request -> new MockUpstream.Response(409,
                "{\"code\":\"STALE_AUTH_GENERATION\",\"message\":\"stale\"}"));
        mockMvc.perform(write("{\"notifications\":false}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        assertThat(NOTI.receivedFor(APPLY).get(0).body()).contains("\"authGeneration\":2");
        assertThat(DATA.hits(DELIVERED)).isZero();
    }

    @Test
    void changedBodyOnSameKeyRemainsAConflictAndCannotReachNotification() throws Exception {
        DATA.on(DATA_PATCH, request -> new MockUpstream.Response(409,
                "{\"code\":\"IDEMPOTENCY_KEY_CONFLICT\",\"message\":\"different\"}"));
        mockMvc.perform(write("{\"notifications\":true}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("IDEMPOTENCY_KEY_REUSED"))
                .andExpect(jsonPath("$.error.field").value("Idempotency-Key"));
        assertThat(NOTI.received()).isEmpty();
    }

    @Test
    void invalidSnapshotAndMissingNotificationBooleanAreNotDefaulted() throws Exception {
        DATA.on(DATA_SNAPSHOT, request -> ok(snapshot().replace("\"authGeneration\":3", "\"authGeneration\":4")));
        mockMvc.perform(auth(get("/me/settings"))).andExpect(status().isBadGateway());
        assertThat(NOTI.received()).isEmpty();
        DATA.on(DATA_SNAPSHOT, request -> ok(snapshot()));
        NOTI.on(INITIALIZE, request -> ok(settings(false).replace("\"notificationEnabled\":false,", "")));
        mockMvc.perform(auth(get("/me/settings"))).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void preservesLegacyReadWithoutSessionClaimsOrNewEnvelope() throws Exception {
        String route = "GET /internal/users/" + USER + "/notification-settings";
        NOTI.on(route, request -> ok(settings(false)));
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.notificationEnabled").value(false))
                .andExpect(jsonPath("$.data").doesNotExist());
        assertThat(DATA.received()).isEmpty();
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockHttpServletRequestBuilder write(String body) {
        return auth(patch("/me/settings")).header("Idempotency-Key", KEY)
                .contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static String token(Map<String, Object> claims) {
        return Jwts.builder().claims(claims).subject(USER.toString()).claim("type", "access")
                .expiration(new Date(System.currentTimeMillis() + 3_600_000))
                .signWith(Keys.hmacShaKeyFor(Tokens.CI_SECRET.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static String settings(boolean enabled) {
        return "{\"notificationEnabled\":" + enabled + ",\"soundEnabled\":false,\"nightModeEnabled\":true,"
                + "\"nightStartTime\":\"22:00\",\"nightEndTime\":null}";
    }

    private static String snapshot() {
        return "{\"version\":7,\"authGeneration\":3,\"settings\":" + settings(true) + "}";
    }

    private static String command(boolean enabled) {
        return "{\"commandId\":\"" + COMMAND + "\",\"eventId\":\"" + COMMAND + "\",\"version\":8,"
                + "\"mask\":[\"notificationEnabled\"],\"patch\":{\"notificationEnabled\":" + enabled + "},"
                + "\"baseline\":" + settings(enabled) + ",\"authGeneration\":3,\"result\":{\"notifications\":"
                + enabled + "}}";
    }

    private static void successfulPatch() {
        DATA.on(DATA_PATCH, request -> ok(command(false)));
        NOTI.on(APPLY, request -> ok("{\"applied\":true}"));
        DATA.on(DELIVERED, request -> ok(null));
    }
}
