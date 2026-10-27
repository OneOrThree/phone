package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;
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
                Arguments.of(200, "{}"), Arguments.of(200, "{\"ownershipToken\":null}"),
                Arguments.of(200, "{\"ownershipToken\":\"\"}"),
                Arguments.of(200, "{\"ownershipToken\":\"  \"}"),
                Arguments.of(200, "{\"ownershipToken\":\"not-a-uuid\"}"),
                Arguments.of(200, "{\"ownershipToken\":\"1-1-1-1-1\"}"),
                Arguments.of(200, "{\"ownershipToken\":\" " + OWNER + "\"}"),
                // 태그가 있어도 소유권이 없으면 여전히 계약 오류다.
                Arguments.of(200, "{\"deliveryTag\":\"t\"}"));
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

    @ParameterizedTest
    @ValueSource(strings = {"abcdefab-1234-4567-890a-abcdefabcdef", "ABCDEFAB-1234-4567-890A-ABCDEFABCDEF"})
    void canonicalOwnershipIsPreservedAndAcceptedByTheNextWrite(String owner) throws Exception {
        stubActiveUser(USER);
        DATA.on(verification(true), request -> new MockUpstream.Response(200, LIVE));
        NOTI.on("POST /internal/devices", request ->
                new MockUpstream.Response(200, "{\"ownershipToken\":\"" + owner + "\"}"));
        register(true).andExpect(status().isOk()).andExpect(jsonPath("$.ownershipToken").value(owner));
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 0, SESSION))
                        .header("Idempotency-Key", "next-registration").contentType("application/json")
                        .content("{\"deviceToken\":\"device\",\"deviceBootstrap\":\"bootstrap\","
                                + "\"ownershipToken\":\"" + owner + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.ownershipToken").value(owner));
        assertThat(NOTI.receivedFor("POST /internal/devices")).hasSize(2);
        assertThat(NOTI.receivedFor("POST /internal/devices").get(1).body()).contains(owner);
    }

    /** 수신 확인 태그(GROMO-2520) — 알림 서버가 준 값을 그대로 앱에 넘긴다. */
    @Test
    void deliveryTagIsPassedThroughAsIs() throws Exception {
        stubRegistrationResponse("{\"ownershipToken\":\"" + OWNER + "\",\"deliveryTag\":\"tag-1\"}");
        register(true).andExpect(status().isOk()).andExpect(jsonPath("$.ownershipToken").value(OWNER))
                .andExpect(jsonPath("$.deliveryTag").value("tag-1"));
    }

    /**
     * 태그 부재는 <b>영구히 정상</b>이다. 알림 서버 V13 전에 저장된 등록 응답은 같은 키로 탈퇴 전까지 재생된다 —
     * 여기서 502 를 내면 그 키의 재시도가 영구 502 가 되고 앱은 새 ownershipToken 까지 잃는다. 키는 생략한다.
     */
    @ParameterizedTest
    @ValueSource(strings = {"", ",\"deliveryTag\":null"})
    void missingDeliveryTagIsStillASuccessWithTheKeyOmitted(String tag) throws Exception {
        stubRegistrationResponse("{\"ownershipToken\":\"" + OWNER + "\"" + tag + "}");
        register(true).andExpect(status().isOk()).andExpect(jsonPath("$.ownershipToken").value(OWNER))
                .andExpect(jsonPath("$", not(hasKey("deliveryTag"))));
    }

    /** 알림 서버가 먼저 배포돼 Business 가 모르는 필드를 더 실어도 등록은 성공한다(additive). */
    @Test
    void unknownFieldsInTheRegistrationResponseStillSucceed() throws Exception {
        stubRegistrationResponse("{\"ownershipToken\":\"" + OWNER + "\",\"deliveryTag\":\"tag-1\","
                + "\"futureField\":{\"nested\":[1,2]}}");
        register(true).andExpect(status().isOk()).andExpect(jsonPath("$.ownershipToken").value(OWNER))
                .andExpect(jsonPath("$.deliveryTag").value("tag-1"));
    }

    private void stubRegistrationResponse(String body) {
        stubActiveUser(USER);
        DATA.on(verification(true), request -> new MockUpstream.Response(200, LIVE));
        NOTI.on("POST /internal/devices", request -> new MockUpstream.Response(200, body));
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
