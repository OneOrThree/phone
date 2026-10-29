package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.FocusPolicyAdminService;
import com.oneorthree.phone.internal.service.FocusPolicyAdminService.ApproveRequest;
import com.oneorthree.phone.internal.service.FocusPolicyAdminService.Policy;
import com.oneorthree.phone.internal.service.FocusPolicyAdminService.PublishRequest;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 운영 Flyway 스키마에서 정책 발행의 원자성·재시도·관리 자격을 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FocusPolicyAdminIntegrationTest {
    private static final String DIGEST = "47b75ef97de2830d8c866c506972940a7f48b8a9df0a73aff83085a419adeb1c";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.console.token", () -> "policy-test-console");
        registry.add("internal.api.callers.console.console-actor", () -> "member-1");
        registry.add("internal.api.callers.console.allow[0]", () -> "GET /internal/admin/policies/focus");
        registry.add("internal.api.callers.console.allow[1]",
                () -> "PUT /internal/admin/policies/focus/publications/*");
        registry.add("internal.api.callers.console.allow[2]",
                () -> "DELETE /internal/admin/policies/focus/approvals/*");
        registry.add("internal.api.callers.approver.token", () -> "policy-test-approver");
        registry.add("internal.api.callers.approver.console-actor", () -> "member-2");
        registry.add("internal.api.callers.approver.allow[0]",
                () -> "POST /internal/admin/policies/focus/approvals/*");
        registry.add("internal.api.callers.business.token", () -> "policy-test-business");
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/admin/policies/focus");
    }

    @Autowired FocusPolicyAdminService policies;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    @BeforeEach
    void reset() {
        jdbc.execute("DELETE FROM focus_reward_policy_publications");
        jdbc.execute("DELETE FROM focus_reward_policy_approvals");
        jdbc.execute("DELETE FROM focus_reward_policies WHERE revision>1");
    }

    @Test
    void 발행은_새_revision과_전후_감사_기록을_원자적으로_남기며_같은_ID만_재생한다() {
        UUID id = UUID.randomUUID();
        Policy policy = new Policy(60, 480, 0, 55, 5, List.of(4000, 12000, 24000, 40000));
        UUID approvalId = UUID.randomUUID();
        policies.approve(approvalId, new ApproveRequest(1, policy, DIGEST), "member-2");
        PublishRequest request = new PublishRequest(approvalId, 1, policy, DIGEST);

        assertThat(policies.get().current().revision()).isEqualTo(1);
        assertThat(policies.get().history()).hasSize(1); // 기존 기본 revision도 보인다.
        var published = policies.publish(id, request, "member-1");
        assertThat(published.revision()).isEqualTo(2);
        assertThat(published.previousRevision()).isEqualTo(1);
        assertThat(policies.publish(id, request, "member-1")).isEqualTo(published);
        assertThat(policies.get().current().policy()).isEqualTo(policy);
        assertThat(policies.get().history()).hasSize(2);
        assertThat(jdbc.queryForObject("SELECT before_policy->>'goldenFishReward'"
                + " FROM focus_reward_policy_publications WHERE publication_id=?", String.class, id))
                .isEqualTo("50");
        assertThat(jdbc.queryForObject("SELECT after_policy->>'goldenFishReward'"
                + " FROM focus_reward_policy_publications WHERE publication_id=?", String.class, id))
                .isEqualTo("55");
        assertThat(jdbc.queryForObject("SELECT actor || '/' || approved_by"
                + " FROM focus_reward_policy_publications WHERE publication_id=?", String.class, id))
                .isEqualTo("member-1/member-2");

        assertThatThrownBy(() -> policies.publish(UUID.randomUUID(), request, "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> policies.publish(id,
                new PublishRequest(UUID.randomUUID(), 1, policy, DIGEST), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> policies.revoke(approvalId, "member-3"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> policies.approve(UUID.randomUUID(),
                new ApproveRequest(1, policy, DIGEST), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_reward_policies", Integer.class)).isEqualTo(2);
    }

    @Test
    void 승인_영수증은_같은_ID_재시도만_허용하고_다른_내용_또는_행위자와_충돌한다() {
        UUID id = UUID.randomUUID();
        Policy policy = new Policy(60, 480, 0, 55, 5, List.of(4000, 12000, 24000, 40000));
        ApproveRequest request = new ApproveRequest(1, policy, DIGEST);
        var first = policies.approve(id, request, "member-2");
        assertThat(policies.approve(id, request, "member-2")).isEqualTo(first);
        assertThatThrownBy(() -> policies.approve(id, request, "member-3"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> policies.approve(id,
                new ApproveRequest(2, policy, DIGEST), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_reward_policy_approvals", Integer.class))
                .isEqualTo(1);
    }

    @Test
    void 승인_취소는_영구_기록되고_동일_취소는_멱등이며_구_승인으로_발행할_수_없다() throws Exception {
        UUID approvalId = UUID.randomUUID();
        Policy policy = new Policy(60, 480, 0, 55, 5, List.of(4000, 12000, 24000, 40000));
        ApproveRequest approved = new ApproveRequest(1, policy, DIGEST);
        policies.approve(approvalId, approved, "member-2");
        mvc.perform(delete("/internal/admin/policies/focus/approvals/{id}", approvalId)
                        .header("Authorization", "Bearer policy-test-console"))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/internal/admin/policies/focus/approvals/{id}", approvalId)
                        .header("Authorization", "Bearer policy-test-console"))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("SELECT revoked_by FROM focus_reward_policy_approvals"
                + " WHERE approval_id=?", String.class, approvalId)).isEqualTo("member-1");
        assertThatThrownBy(() -> policies.approve(approvalId, approved, "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> policies.publish(UUID.randomUUID(),
                new PublishRequest(approvalId, 1, policy, DIGEST), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_reward_policy_publications", Integer.class))
                .isZero();
    }

    @Test
    void 승인_스냅샷과_유효하지_않은_확률을_거부하고_원장을_남기지_않는다() {
        Policy policy = new Policy(60, 480, 0, 55, 5, List.of(4000, 12000, 24000, 40000));
        UUID approvalId = UUID.randomUUID();
        assertThatThrownBy(() -> policies.publish(UUID.randomUUID(),
                new PublishRequest(approvalId, 1, policy, "0".repeat(64)), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> policies.publish(UUID.randomUUID(),
                new PublishRequest(approvalId, 1, new Policy(60, 480, 0, 55, 5,
                        List.of(4000, 12000, 1000001, 1000001)), DIGEST), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> policies.publish(UUID.randomUUID(),
                new PublishRequest(approvalId, 1, new Policy(1, Integer.MAX_VALUE, 0, 55, 5,
                        List.of(4000, 12000, 24000, 40000)), DIGEST), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> policies.publish(UUID.randomUUID(),
                new PublishRequest(approvalId, 1, new Policy(60, 480, 0, Integer.MAX_VALUE, 5,
                        List.of(4000, 12000, 24000, 40000)), DIGEST), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        policies.approve(approvalId, new ApproveRequest(1, policy, DIGEST), "member-2");
        assertThatThrownBy(() -> policies.publish(UUID.randomUUID(),
                new PublishRequest(approvalId, 1, policy, DIGEST), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_reward_policy_publications", Integer.class))
                .isZero();
    }

    @Test
    void 관리_자격만_정책을_볼_수_있고_요청_행위자_위조도_막는다() throws Exception {
        mvc.perform(get("/internal/admin/policies/focus")
                        .header("Authorization", "Bearer policy-test-console"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.current.revision").value(1))
                .andExpect(jsonPath("$.current.policy.goldenChancePpm[0]").value(4000));
        mvc.perform(get("/internal/admin/policies/focus")
                        .header("Authorization", "Bearer policy-test-business"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/internal/admin/policies/focus")
                        .header("Authorization", "Bearer policy-test-console")
                        .header("X-Console-Actor", "member-2"))
                .andExpect(status().isForbidden());
    }

    @Test
    void PUT은_토큰에_결박된_발행자를_기록한다() throws Exception {
        UUID id = UUID.randomUUID();
        UUID approvalId = UUID.randomUUID();
        String body = "{\"expectedRevision\":1,\"policy\":{\"secondsPerFish\":60,"
                + "\"dailyCapFish\":480,\"personalSharePercent\":0,\"goldenFishReward\":55,"
                + "\"goldenMaxMembers\":5,\"goldenChancePpm\":[4000,12000,24000,40000]},"
                + "\"approvedDigest\":\"" + DIGEST + "\"}";
        mvc.perform(post("/internal/admin/policies/focus/approvals/{id}", approvalId)
                        .header("Authorization", "Bearer policy-test-approver")
                        .contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.approvedBy").value("member-2"));
        String publicationBody = body.substring(0, body.length() - 1)
                + ",\"approvalId\":\"" + approvalId + "\"}";
        mvc.perform(put("/internal/admin/policies/focus/publications/{id}", id)
                        .header("Authorization", "Bearer policy-test-console")
                        .contentType("application/json").content(publicationBody))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(2))
                .andExpect(jsonPath("$.actor").value("member-1"));
        assertThat(jdbc.queryForObject("SELECT actor FROM focus_reward_policy_publications"
                + " WHERE publication_id=?", String.class, id)).isEqualTo("member-1");
    }

    @Test
    void 같은_예상_revision의_동시_발행은_한_건만_성공한다() throws Exception {
        Policy policy = new Policy(60, 480, 0, 55, 5, List.of(4000, 12000, 24000, 40000));
        UUID firstApprovalId = UUID.randomUUID();
        UUID secondApprovalId = UUID.randomUUID();
        policies.approve(firstApprovalId, new ApproveRequest(1, policy, DIGEST), "member-2");
        policies.approve(secondApprovalId, new ApproveRequest(1, policy, DIGEST), "member-3");
        var executor = Executors.newFixedThreadPool(2);
        try {
            var first = executor.submit(() -> publishOutcome(UUID.randomUUID(),
                    new PublishRequest(firstApprovalId, 1, policy, DIGEST)));
            var second = executor.submit(() -> publishOutcome(UUID.randomUUID(),
                    new PublishRequest(secondApprovalId, 1, policy, DIGEST)));
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("published", "conflict");
        } finally {
            executor.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_reward_policy_publications", Integer.class))
                .isEqualTo(1);
    }

    private String publishOutcome(UUID id, PublishRequest request) {
        try {
            policies.publish(id, request, "member-1");
            return "published";
        } catch (ResponseStatusException e) {
            assertThat(e.getStatusCode().value()).isEqualTo(409);
            return "conflict";
        }
    }
}
