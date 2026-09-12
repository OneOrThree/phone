package com.oneorthree.business.api;

import com.oneorthree.business.config.CompatProperties;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 필수 이관 식별자 누락을 후보 없음으로 확정하지 않는다. 실제 HTTP 조회·소진 경계를 검증한다. */
@TestPropertySource(properties = {
        "business.compat.match-handler-enabled=true",
        "business.compat.import-contract-ready=true",
        "business.compat.migration-id="
})
class CompatMatchMigrationIdContractTest extends UpstreamTestBase {
    private static final String REQUEST = "{\"os\":\"ios\",\"deviceId\":\"same-install\"}";
    private static final String CANDIDATES = "GET /internal/migrations/recovered/invite-link-clicks/candidates";
    @Autowired CompatProperties properties;

    @AfterEach
    void restoreSettings() {
        properties.setMigrationId("");
        properties.setImportContractReady(true);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void requiredImportWithoutAnIdCannotConsumeAndRecoversAfterConfigurationIsFixed(String migrationId)
            throws Exception {
        properties.setMigrationId(migrationId);
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));
        mockMvc.perform(post("/l/match").contentType("application/json").content(REQUEST))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(DATA.received()).isEmpty();
        assertThat(LINK.received()).isEmpty();

        properties.setMigrationId("recovered");
        DATA.on(CANDIDATES, request -> new MockUpstream.Response(200,
                "[{\"source\":{\"slug\":\"old-invite\"},\"sourceChecksum\":\"checksum\"}]"));
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":true,\"slug\":\"old-invite\"}"));
        mockMvc.perform(post("/l/match").contentType("application/json").content(REQUEST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.slug").value("old-invite"));
        assertThat(DATA.hits(CANDIDATES)).isEqualTo(1);
        assertThat(LINK.receivedFor("POST /internal/links/match")).singleElement()
                .satisfies(request -> assertThat(request.body())
                        .contains("\"migrationId\":\"recovered\"", "old-invite", "checksum"));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void optionalObservationWithoutAnIdStillUsesOnlyTheLiveLinkCandidates(String migrationId) throws Exception {
        properties.setMigrationId(migrationId);
        properties.setImportContractReady(false);
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));
        mockMvc.perform(post("/l/match").contentType("application/json").content(REQUEST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.matched").value(false));
        assertThat(DATA.received()).isEmpty();
        assertThat(LINK.receivedFor("POST /internal/links/match")).singleElement()
                .satisfies(request -> assertThat(request.body())
                        .contains("\"migrationId\":null", "\"frozenCandidates\":null"));
    }
}
