package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 HTTP 응답이 부실하면 삭제 내구 기록·세션 범위를 확정하지 않는다. */
class DeviceDeletionResponseContractTest extends UpstreamTestBase {
    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final String COMMAND = "bbbbbbbb-0000-0000-0000-000000000001";
    private static final String RECORD = "POST /internal/users/" + USER + "/device-token-deletions";
    private static final String COMPLETE = "POST /internal/outbox-commands/" + COMMAND + "/delivered";
    private static final String ACK = "\"commandId\":\"" + COMMAND + "\",\"eventId\":\"evt\",\"version\":3";
    private static final String SCOPE = "\"params\":{\"sessionId\":\"" + SESSION
            + "\",\"bootstrapNonceHash\":null}";

    static Stream<String> invalidRecords() {
        return Stream.of("", "null", "{}", "{\"version\":3}",
                "{\"eventId\":\"evt\",\"version\":3}",
                "{\"commandId\":\"" + COMMAND + "\",\"version\":3}",
                "{" + ACK.replace("\"evt\"", "null") + "}",
                "{" + ACK.replace("\"evt\"", "\" \"") + "}",
                "{" + ACK.replace("\"version\":3", "\"version\":0") + "}",
                "{" + ACK.replace("\"version\":3", "\"version\":-1") + "}",
                "{" + ACK.replace(",\"version\":3", "") + "}",
                "{" + ACK.replace("\"version\":3", "\"version\":null") + "}");
    }

    @ParameterizedTest
    @MethodSource("invalidRecords")
    void anExplicitDeviceCanStillBeDeletedButAnInvalidRecordIsNeverCompleted(String body) throws Exception {
        stub(body);
        mockMvc.perform(delete("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("X-Device-Token", "test-device"))
                .andExpect(status().isNoContent());
        assertThat(NOTI.received()).hasSize(1);
        assertThat(DATA.received()).allMatch(request -> RECORD.equals(request.methodAndPath()));
    }

    @ParameterizedTest
    @MethodSource("invalidRecords")
    void anInvalidRecordCannotAuthorizeASessionScopedDeleteAndTheSameKeyCanRetry(String body) throws Exception {
        stub(body.startsWith("{") ? body.substring(0, body.length() - 1)
                + ("{}".equals(body) ? "" : ",") + SCOPE + "}" : body);
        sessionDelete().andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(NOTI.received()).isEmpty();
        assertThat(DATA.hits(COMPLETE)).isZero();
        DATA.on(RECORD, request -> new MockUpstream.Response(200, "{" + ACK + "," + SCOPE + "}"));
        sessionDelete().andExpect(status().isNoContent());
        assertThat(NOTI.received()).hasSize(1);
        assertThat(DATA.hits(COMPLETE)).isEqualTo(1);
    }

    static Stream<String> invalidScopes() {
        return Stream.of("", ",\"params\":null", ",\"params\":{}",
                ",\"params\":{\"sessionId\":\"" + SESSION + "\"}",
                ",\"params\":{\"sessionId\":\"" + UUID.randomUUID() + "\",\"bootstrapNonceHash\":null}",
                ",\"params\":{\"sessionId\":12,\"bootstrapNonceHash\":null}",
                "," + SCOPE.replace("\"bootstrapNonceHash\":null", "\"bootstrapNonceHash\":12"),
                "," + SCOPE.replace("\"bootstrapNonceHash\":null", "\"bootstrapNonceHash\":\"\""),
                "," + SCOPE.replace("\"bootstrapNonceHash\":null", "\"bootstrapNonceHash\":\"wrong\""));
    }

    @ParameterizedTest
    @MethodSource("invalidScopes")
    void incompleteScopeNeverDeletesOrCompletesTheRecordedCommand(String scope) throws Exception {
        stub("{" + ACK + scope + "}");
        sessionDelete().andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(NOTI.received()).isEmpty();
        assertThat(DATA.hits(COMPLETE)).isZero();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void aCompleteRecordPreservesExplicitlyNullableBootstrapAndTheOriginalHash(boolean bootstrap) throws Exception {
        String hash = bootstrap ? "a".repeat(64) : null;
        stub("{" + ACK + "," + SCOPE.replace("\"bootstrapNonceHash\":null",
                "\"bootstrapNonceHash\":" + (hash == null ? "null" : "\"" + hash + "\"")) + "}");
        sessionDelete().andExpect(status().isNoContent());
        assertThat(NOTI.received().get(0).header("X-Device-Session")).isEqualTo(SESSION.toString());
        assertThat(NOTI.received().get(0).header("X-Device-Bootstrap-Hash")).isEqualTo(hash);
        assertThat(DATA.hits(COMPLETE)).isEqualTo(1);
    }

    private org.springframework.test.web.servlet.ResultActions sessionDelete() throws Exception {
        return mockMvc.perform(delete("/api/v1/users/me/device-token")
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 0, SESSION))
                .header("Idempotency-Key", "same-device-delete"));
    }

    private static void stub(String body) {
        DATA.on(RECORD, request -> new MockUpstream.Response(body.isEmpty() ? 204 : 200, body));
        NOTI.on("DELETE /internal/devices", request -> new MockUpstream.Response(204, null));
        DATA.on(COMPLETE, request -> new MockUpstream.Response(204, null));
    }
}
