package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DeviceSessionResponseContractTest extends UpstreamTestBase {
    private static final UUID USER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID SESSION = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final String OWNER = "33333333-3333-4333-8333-333333333333";
    private static final String LIVE = "{\"active\":true,\"sessionEpoch\":1}";

    static Stream<Arguments> incompleteSessionResponses() {
        return Stream.of(false, true).flatMap(bootstrap -> Stream.of(
                Arguments.of(bootstrap, 204, null),
                Arguments.of(bootstrap, 200, ""),
                Arguments.of(bootstrap, 200, "null"),
                Arguments.of(bootstrap, 200, "{}"),
                Arguments.of(bootstrap, 200, "{\"sessionEpoch\":1}"),
                Arguments.of(bootstrap, 200, "{\"active\":null,\"sessionEpoch\":1}"),
                Arguments.of(bootstrap, 200, "{\"active\":true}"),
                Arguments.of(bootstrap, 200, "{\"active\":true,\"sessionEpoch\":null}")));
    }

    @ParameterizedTest
    @MethodSource("incompleteSessionResponses")
    void incompletePrecheckIsAContractErrorAndDoesNotRegister(boolean bootstrap, int code, String body)
            throws Exception {
        stubActiveUser(USER);
        DATA.on(verification(bootstrap), request -> new MockUpstream.Response(code, body));
        register(bootstrap).andExpect(status().isBadGateway());
        assertThat(NOTI.received()).isEmpty();
    }

    @ParameterizedTest
    @MethodSource("incompleteSessionResponses")
    void incompletePostcheckIsNotEvidenceToDeleteASuccessfulRegistration(boolean bootstrap, int code, String body)
            throws Exception {
        stubActiveUser(USER);
        AtomicInteger checks = new AtomicInteger();
        DATA.on(verification(bootstrap), request -> checks.getAndIncrement() == 0
                ? new MockUpstream.Response(200, LIVE) : new MockUpstream.Response(code, body));
        stubRegistration();
        register(bootstrap).andExpect(status().isOk()).andExpect(jsonPath("$.ownershipToken").value(OWNER));
        assertThat(checks.get()).isEqualTo(2);
        assertThat(NOTI.hits("DELETE /internal/devices")).isZero();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void explicitInactiveSessionRemainsAnAuthenticationFailure(boolean bootstrap) throws Exception {
        stubActiveUser(USER);
        DATA.on(verification(bootstrap), request ->
                new MockUpstream.Response(200, "{\"active\":false,\"sessionEpoch\":0}"));
        register(bootstrap).andExpect(status().isUnauthorized());
        assertThat(NOTI.received()).isEmpty();
    }

    static Stream<Arguments> incompleteRegistrationResponses() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{}"), Arguments.of(200, "{\"ownershipToken\":null}"));
    }

    @ParameterizedTest
    @MethodSource("incompleteRegistrationResponses")
    void missingRegistrationResultFailsAndTheSameIntentCanRecoverItsOwnership(int code, String body)
            throws Exception {
        stubActiveUser(USER);
        DATA.on(verification(true), request -> new MockUpstream.Response(200, LIVE));
        AtomicInteger attempts = new AtomicInteger();
        NOTI.on("POST /internal/devices", request -> attempts.getAndIncrement() == 0
                ? new MockUpstream.Response(code, body)
                : new MockUpstream.Response(200, "{\"ownershipToken\":\"" + OWNER + "\"}"));

        register(true).andExpect(status().isBadGateway());
        register(true).andExpect(status().isOk()).andExpect(jsonPath("$.ownershipToken").value(OWNER));

        assertThat(NOTI.hits("POST /internal/devices")).isEqualTo(2);
        assertThat(NOTI.hits("DELETE /internal/devices")).isZero();
        assertThat(NOTI.received().get(0).header("Idempotency-Key"))
                .isEqualTo(NOTI.received().get(1).header("Idempotency-Key"));
        assertThat(NOTI.received().get(0).body()).isEqualTo(NOTI.received().get(1).body());
    }

    private void stubRegistration() {
        NOTI.on("POST /internal/devices", request ->
                new MockUpstream.Response(200, "{\"ownershipToken\":\"" + OWNER + "\"}"));
    }

    private org.springframework.test.web.servlet.ResultActions register(boolean bootstrap) throws Exception {
        return mockMvc.perform(put("/api/v1/users/me/device-token")
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 0, SESSION))
                .header("Idempotency-Key", "same-registration")
                .contentType("application/json")
                .content(bootstrap ? "{\"deviceToken\":\"device\",\"deviceBootstrap\":\"bootstrap\"}"
                        : "{\"deviceToken\":\"device\"}"));
    }

    private static String verification(boolean bootstrap) {
        return bootstrap ? "POST /internal/auth/device-sessions/verify" : "POST /internal/auth/sessions/verify";
    }
}
