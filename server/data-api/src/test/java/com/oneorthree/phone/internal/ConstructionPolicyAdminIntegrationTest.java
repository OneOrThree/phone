package com.oneorthree.phone.internal;

import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.domain.IslandWallet;
import com.oneorthree.phone.construction.service.IslandConstructionService;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.service.ContentJson;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.ConstructionPolicyRequest;
import com.oneorthree.phone.internal.dto.ConstructionPolicyView;
import com.oneorthree.phone.internal.service.ConstructionPolicyAdminService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 외부 서비스 없이 실제 PostgreSQL의 정책 잠금·영수증·착공 계약을 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ConstructionPolicyAdminIntegrationTest {
    private static final String PATH = "/internal/admin/content/construction-policy";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.console.token", () -> "policy-local-console");
        registry.add("internal.api.callers.console.console-actor", () -> "member-1");
        registry.add("internal.api.callers.console.allow[0]", () -> "GET " + PATH);
        registry.add("internal.api.callers.console.allow[1]", () -> "PUT " + PATH + "/*");
        registry.add("internal.api.callers.business.token", () -> "policy-local-business");
        registry.add("internal.api.callers.business.allow[0]", () -> "GET " + PATH);
    }

    @Autowired ConstructionPolicyAdminService policies;
    @Autowired IslandConstructionService construction;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired GroupRepository groups;
    @Autowired GroupMemberRepository members;
    @Autowired IslandWalletRepository wallets;

    @BeforeEach
    void resetPolicies() {
        jdbc.update("UPDATE construction_cost_policy_publication SET revision=1 WHERE singleton=true");
        jdbc.update("DELETE FROM construction_cost_policies WHERE revision>1");
        jdbc.update("DELETE FROM content_publications WHERE kind='CONSTRUCTION'");
    }

    @Test
    void appliesWholePolicyAndReplaysAfterAnotherRevisionWithoutChangingThePast() {
        var original = policies.current();
        assertThat(original.items()).hasSize(7);
        UUID id = UUID.randomUUID();
        var input = changed(original);
        var first = policies.apply(id, input, "member-1");
        assertThat(first.previousRevision()).isEqualTo(1);
        assertThat(first.costPolicyVersion()).isEqualTo(2);
        assertThat(first.before()).isEqualTo(original.items());
        assertThat(policies.current().items()).isEqualTo(first.items());
        policies.apply(UUID.randomUUID(), changed(policies.current()), "member-2");
        assertThat(policies.apply(id, input, "member-1")).isEqualTo(first);
        assertThat(policies.current().costPolicyVersion()).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT cost FROM construction_cost_policies"
                + " WHERE revision=1 AND building_id='hall'", Integer.class)).isEqualTo(60);
        assertThat(receipts()).isEqualTo(2);
        assertThatThrownBy(() -> policies.apply(id, changed(policies.current()), "member-1"))
                .isInstanceOf(ContentException.class).hasMessageContaining("다른 내용");
    }

    @Test
    void rejectsIncompleteDuplicateUnknownAndNonIntegerValues() {
        var input = changed(policies.current());
        var missing = new ArrayList<>(input.items());
        missing.remove(0);
        invalid(new ConstructionPolicyRequest(BigDecimal.ONE, missing));
        var duplicate = new ArrayList<>(input.items());
        duplicate.set(0, duplicate.get(1));
        invalid(new ConstructionPolicyRequest(BigDecimal.ONE, duplicate));
        var unknown = new ArrayList<>(input.items());
        unknown.set(0, new ConstructionPolicyRequest.Item("unknown", BigDecimal.ONE, BigDecimal.ONE));
        invalid(new ConstructionPolicyRequest(BigDecimal.ONE, unknown));
        for (String cost : List.of("-1", "0", "1.1", "2147483648")) {
            var values = new ArrayList<>(input.items());
            var first = values.get(0);
            values.set(0, new ConstructionPolicyRequest.Item(first.buildingId(),
                    new BigDecimal(cost), first.buildSeconds()));
            invalid(new ConstructionPolicyRequest(BigDecimal.ONE, values));
        }
        var seconds = new ArrayList<>(input.items());
        var first = seconds.get(0);
        seconds.set(0, new ConstructionPolicyRequest.Item(first.buildingId(), first.cost(), new BigDecimal("0.5")));
        invalid(new ConstructionPolicyRequest(BigDecimal.ONE, seconds));
        assertThat(policies.current().costPolicyVersion()).isEqualTo(1);
        assertThat(receipts()).isZero();
    }

    @Test
    void receiptFailureRollsBackThePolicyRowsAndPointer() {
        var original = policies.current();
        assertThatThrownBy(() -> policies.apply(UUID.randomUUID(), changed(original), "not-an-operator"))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThat(policies.current()).isEqualTo(original);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM construction_cost_policies WHERE revision>1",
                Integer.class)).isZero();
    }

    @Test
    void concurrentDifferentPublicationsPermitOnlyOneReviewedRevision() throws Exception {
        var request = changed(policies.current());
        var pool = Executors.newFixedThreadPool(2);
        var start = new CountDownLatch(1);
        try {
            var futures = java.util.stream.IntStream.range(0, 2).mapToObj(index -> pool.submit(() -> {
                start.await();
                try {
                    policies.apply(UUID.randomUUID(), request, "member-1");
                    return 1;
                } catch (ContentException conflict) {
                    assertThat(conflict.getMessage()).contains("다시 검토");
                    return 0;
                }
            })).toList();
            start.countDown();
            int successes = 0;
            for (var result : futures) {
                successes += result.get(15, TimeUnit.SECONDS);
            }
            assertThat(successes).isEqualTo(1);
            assertThat(receipts()).isEqualTo(1);
            assertThat(policies.current().costPolicyVersion()).isEqualTo(2);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void existingConstructionKeepsItsPriceAndCompletionAndStaleNewStartsAreRejected() {
        User owner = users.save(User.builder().nickname("정책-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("건설 정책 검증 섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(island).role(GroupMemberRole.OWNER).build());
        wallets.save(IslandWallet.builder().islandId(island.getId()).balance(10000).build());
        UUID key = UUID.randomUUID();
        var first = construction.start(island.getId(), owner.getId(), "hall", 0, 1, key);
        var facility = jdbc.queryForMap("SELECT * FROM island_facilities WHERE island_id=?", island.getId());
        policies.apply(UUID.randomUUID(), changed(policies.current()), "member-1");
        assertThat(jdbc.queryForMap("SELECT * FROM island_facilities WHERE island_id=?", island.getId()))
                .isEqualTo(facility);
        assertThat(construction.start(island.getId(), owner.getId(), "hall", 0, 1, key)).isEqualTo(first);
        long version = construction.options(island.getId(), owner.getId()).islandVersion();
        assertThatThrownBy(() -> construction.start(island.getId(), owner.getId(), "board", version, 1,
                UUID.randomUUID())).isInstanceOf(ConstructionException.class)
                .hasMessageContaining("다른 변경");
    }

    @Test
    void onlyMatchingConsoleIdentityCanReadAndApplyAndFractionalHttpInputIsRejected() throws Exception {
        mvc.perform(get(PATH)).andExpect(status().isUnauthorized());
        mvc.perform(get(PATH).header("Authorization", "Bearer policy-local-business"))
                .andExpect(status().isForbidden());
        mvc.perform(get(PATH).header("Authorization", "Bearer policy-local-console")
                .header("X-Console-Actor", "member-2")).andExpect(status().isForbidden());
        mvc.perform(get(PATH).header("Authorization", "Bearer policy-local-console")
                .header("X-Console-Actor", "member-1")).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(7));
        String body = ContentJson.write(changed(policies.current()));
        mvc.perform(put(PATH + "/" + UUID.randomUUID()).header("Authorization", "Bearer policy-local-console")
                .header("X-Console-Actor", "member-1").contentType(MediaType.APPLICATION_JSON)
                .content(body.replace("\"cost\":61", "\"cost\":61.5"))).andExpect(status().isBadRequest());
        mvc.perform(put(PATH + "/" + UUID.randomUUID()).header("Authorization", "Bearer policy-local-console")
                .header("X-Console-Actor", "member-1").contentType(MediaType.APPLICATION_JSON)
                .content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.costPolicyVersion").value(2));
    }

    private ConstructionPolicyRequest changed(ConstructionPolicyView current) {
        return new ConstructionPolicyRequest(BigDecimal.valueOf(current.costPolicyVersion()),
                current.items().stream().map(item -> new ConstructionPolicyRequest.Item(item.buildingId(),
                        BigDecimal.valueOf(item.cost() + 1L), BigDecimal.valueOf(item.buildSeconds() + 1L))).toList());
    }

    private void invalid(ConstructionPolicyRequest input) {
        assertThatThrownBy(() -> policies.apply(UUID.randomUUID(), input, "member-1"))
                .isInstanceOf(ContentException.class);
    }

    private int receipts() {
        return jdbc.queryForObject("SELECT count(*) FROM content_publications WHERE kind='CONSTRUCTION'",
                Integer.class);
    }
}
