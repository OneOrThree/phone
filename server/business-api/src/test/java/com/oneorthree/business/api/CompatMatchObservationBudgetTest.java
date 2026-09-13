package com.oneorthree.business.api;

import com.oneorthree.business.config.CompatProperties;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 느린 Data 관측이 정상 Link 소진의 전체 예산을 먼저 쓰지 못한다. */
@TestPropertySource(properties = {
        "business.compat.match-handler-enabled=true",
        "business.compat.import-contract-ready=false",
        "business.compat.migration-id=observation-budget",
        "business.upstream.data.read-timeout=2s",
        "business.upstream.link.read-timeout=2s",
        "business.upstream.data.failure-threshold=100",
        "business.upstream.link.failure-threshold=100"
})
class CompatMatchObservationBudgetTest extends UpstreamTestBase {
    private static final String EXPORT = "GET /internal/migrations/observation-budget/invite-link-clicks/candidates";
    private static final String MATCH = "POST /internal/links/match";
    private static final String BODY = "{\"os\":\"ios\",\"deviceId\":\"device\",\"appInstanceId\":\"install\"}";
    private static final String RESULT = "{\"matched\":true,\"slug\":\"invite\","
            + "\"groupId\":\"11111111-1111-4111-8111-111111111111\"}";
    @Autowired CompatProperties properties;

    @AfterEach
    void restore() {
        properties.setImportContractReady(false);
        properties.setMatchBudget(Duration.ofSeconds(3));
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 800})
    void optionalSlowObservationCannotPreventAMatch(int budgetMillis) throws Exception {
        properties.setMatchBudget(Duration.ofMillis(budgetMillis));
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(1);
        DATA.on(EXPORT, request -> {
            try {
                await(release, 5000);
                return new MockUpstream.Response(200, "[]");
            } finally {
                finished.countDown();
            }
        });
        LINK.on(MATCH, request -> new MockUpstream.Response(200, RESULT));
        long start = System.nanoTime();
        try {
            mockMvc.perform(post("/l/match").contentType("application/json").content(BODY))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.matched").value(true));
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofMillis(budgetMillis));
            assertThat(LINK.receivedFor(MATCH)).singleElement().satisfies(request ->
                    assertThat(request.body()).contains("\"migrationId\":null", "\"frozenCandidates\":null"));
            assertThat(DATA.hits(EXPORT)).isEqualTo(1);
        } finally {
            release.countDown();
            assertThat(finished.await(2, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void mandatoryImportStillSharesOneDeadlineAcrossBothHttpCalls() throws Exception {
        properties.setImportContractReady(true);
        properties.setMatchBudget(Duration.ofMillis(700));
        CountDownLatch finished = new CountDownLatch(1);
        DATA.on(EXPORT, request -> {
            await(new CountDownLatch(1), 300);
            return new MockUpstream.Response(200, "[]");
        });
        LINK.on(MATCH, request -> {
            try {
                await(new CountDownLatch(1), 550);
                return new MockUpstream.Response(200, RESULT);
            } finally {
                finished.countDown();
            }
        });
        try {
            mockMvc.perform(post("/l/match").contentType("application/json").content(BODY))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("UPSTREAM_UNAVAILABLE"));
            assertThat(LINK.receivedFor(MATCH)).singleElement().satisfies(request ->
                    assertThat(request.body()).contains("\"migrationId\":\"observation-budget\"",
                            "\"frozenCandidates\":[]"));
        } finally {
            assertThat(finished.await(2, TimeUnit.SECONDS)).isTrue();
        }
    }

    private static void await(CountDownLatch latch, long millis) {
        try {
            latch.await(millis, TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }
}
