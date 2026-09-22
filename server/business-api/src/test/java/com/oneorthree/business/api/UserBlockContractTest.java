package com.oneorthree.business.api;

import com.oneorthree.business.support.UpstreamTestBase;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** /blocks 공개 봉투·내부 경로·오류 변환 계약 (GROMO-1975). */
class UserBlockContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000075");
    private static final UUID TARGET = UUID.fromString("cccccccc-0000-0000-0000-000000000075");
    private static final String INTERNAL = "/internal/users/" + USER + "/blocks";
    private static final String BODY = "{\"blockedUserId\":\"" + TARGET + "\"}";

    @Test
    void blockAndUnblockForwardSignedActorAndReturnEmptyEnvelope() throws Exception {
        DATA.on("POST " + INTERNAL, request -> ok(""));
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isOk()).andExpect(content().json("{\"data\":null}"));
        DATA.on("DELETE " + INTERNAL + "/" + TARGET, request -> ok(""));
        mockMvc.perform(auth(delete("/blocks/" + TARGET)))
                .andExpect(status().isOk()).andExpect(content().json("{\"data\":null}"));
        assertThat(DATA.received()).allSatisfy(call ->
                assertThat(call.header("x-user-id")).isEqualTo(USER.toString()));
    }

    @Test
    void listUsesPublicEnvelopeAndPreservesIdNameShape() throws Exception {
        DATA.on("GET " + INTERNAL, request -> ok("[{\"id\":\"" + TARGET + "\",\"name\":\"차단상대\"}]"));
        mockMvc.perform(auth(get("/blocks")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(TARGET.toString()))
                .andExpect(jsonPath("$.data[0].name").value("차단상대"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "null", "{\"blockedUserId\":1}",
            "{\"blockedUserId\":\"cccccccc-0000-0000-0000-000000000075\",\"extra\":true}"})
    void blockRejectsMalformedBodyBeforeNetwork(String body) throws Exception {
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(body)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void blockMapsOnlyRegisteredDomainFailures() throws Exception {
        DATA.on("POST " + INTERNAL, request -> error(400, "SELF_BLOCK"));
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("blockedUserId"));
        DATA.on("POST " + INTERNAL, request -> error(400, "UNKNOWN_BLOCK_ERROR"));
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, UUID.randomUUID()));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
