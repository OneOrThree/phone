package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.stream.Stream;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ActiveUserGuardContractTest extends UpstreamTestBase {
    private static final UUID USER = UUID.randomUUID();
    private static final String ACTIVATION = "GET /internal/users/" + USER + "/activation";

    static Stream<MockUpstream.Response> missingDecisions() {
        return Stream.of(new MockUpstream.Response(204, null), new MockUpstream.Response(200, null),
                new MockUpstream.Response(200, "null"), new MockUpstream.Response(200, "{}"),
                new MockUpstream.Response(200, "{\"active\":null}"));
    }

    @ParameterizedTest
    @MethodSource("missingDecisions")
    void missingActivationIsAContractErrorAndTheSameRegistrationCanRetry(MockUpstream.Response missing)
            throws Exception {
        DATA.on(ACTIVATION, request -> missing);
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-registration")
                        .contentType("application/json").content("{\"deviceToken\":\"device\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(NOTI.received()).isEmpty();
        assertThat(LINK.received()).isEmpty();
        assertThat(DATA.hits(ACTIVATION)).isEqualTo(1);

        stubActiveUser(USER);
        NOTI.on("POST /internal/devices", request -> new MockUpstream.Response(200,
                "{\"ownershipToken\":\"" + UUID.randomUUID() + "\"}"));
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-registration")
                        .contentType("application/json").content("{\"deviceToken\":\"device\"}"))
                .andExpect(status().isOk());
        assertThat(NOTI.received()).hasSize(1);
    }
}
