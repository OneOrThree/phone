package com.oneorthree.phone.internal;

import com.oneorthree.phone.appearance.dto.CustomizationRewardResult;
import com.oneorthree.phone.appearance.service.CustomizationRewardService;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.repository.domain.FocusSessionKind;
import com.oneorthree.phone.internal.service.CustomizationRewardPoolAdminService;
import com.oneorthree.phone.internal.service.CustomizationRewardPoolAdminService.ApproveRequest;
import com.oneorthree.phone.internal.service.CustomizationRewardPoolAdminService.PublishRequest;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.random.RandomGenerator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 꾸미기 아이템 현황과 추첨 풀 승인·발행 (GROMO-2829) — 운영 Flyway 스키마와 V0 시드(revision 1 = 90종, revision 2 = 머리·목
 * 20종)에서 돈다. 정책·아이템 행은 시험이 만들지 않는다. 발행이 실제로 복사한 행을 추첨({@link CustomizationRewardService})이
 * 읽는지까지 확인한다. 컨텍스트마다 DB 가 따로라 발행 전 최대 revision 은 2 다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CustomizationRewardPoolAdminIntegrationTest {
    private static final String BASE = "/internal/admin/customization";
    private static final String MEMBER_1 = "Bearer pool-test-member-1";
    private static final String MEMBER_2 = "Bearer pool-test-member-2";
    private static final String BUSINESS = "Bearer pool-test-business";
    private static final List<String> ADMIN_ROUTES = List.of(
            "GET " + BASE + "/items",
            "GET " + BASE + "/reward-pool",
            "POST " + BASE + "/reward-pool/approvals/*",
            "DELETE " + BASE + "/reward-pool/approvals/*",
            "PUT " + BASE + "/reward-pool/publications/*");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        for (String caller : List.of("member1", "member2")) {
            String token = caller.equals("member1") ? "pool-test-member-1" : "pool-test-member-2";
            registry.add("internal.api.callers." + caller + ".token", () -> token);
            registry.add("internal.api.callers." + caller + ".console-actor",
                    () -> caller.equals("member1") ? "member-1" : "member-2");
            for (int i = 0; i < ADMIN_ROUTES.size(); i++) {
                String route = ADMIN_ROUTES.get(i);
                registry.add("internal.api.callers." + caller + ".allow[" + i + "]", () -> route);
            }
        }
        // business 에 새 경로를 «허용목록으로는» 열어 둔다 — 그래도 403 이면 관리 actor 검사가 막은 것이다.
        registry.add("internal.api.callers.business.token", () -> "pool-test-business");
        for (int i = 0; i < ADMIN_ROUTES.size(); i++) {
            String route = ADMIN_ROUTES.get(i);
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> route);
        }
        registry.add("internal.api.callers.business.allow[" + ADMIN_ROUTES.size() + "]",
                () -> "GET /internal/customization/catalog");
    }

    @Autowired CustomizationRewardPoolAdminService pool;
    @Autowired CustomizationRewardService rewards;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired TransactionTemplate tx;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @MockitoBean RandomGenerator random;

    @BeforeEach
    void reset() {
        jdbc.execute("DELETE FROM customization_reward_pool_publications");
        jdbc.execute("DELETE FROM customization_reward_pool_approvals");
        jdbc.execute("DELETE FROM customization_reward_items WHERE revision>2");
        jdbc.execute("DELETE FROM customization_reward_policies WHERE revision>2");
        jdbc.execute("DELETE FROM customization_asset_meta WHERE product_id LIKE 'pooltest.%' OR product_id='cust.head.bun'");
        jdbc.execute("DELETE FROM owned_products WHERE product_id LIKE 'cust.%'");
        jdbc.execute("DELETE FROM catalog_assets WHERE product_id LIKE 'pooltest.%'");
    }

    // ------------------------------------------------------------------ 승인·발행 규칙

    @Test
    @DisplayName("승인자 = 발행자면 409 이고 DB CHECK 도 같은 행을 막는다")
    void approverCannotPublishAndTheDatabaseAgrees() {
        List<String> full = currentPool();
        UUID approvalId = UUID.randomUUID();
        pool.approve(approvalId, approve(2, full), "member-2");

        assertThatThrownBy(() -> pool.publish(UUID.randomUUID(), publish(approvalId, 2, full), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThat(count("customization_reward_pool_publications")).isZero();
        assertThat(maxRevision()).isEqualTo(2);

        // 서비스 검사를 건너뛴 수동 SQL 도 막는다.
        jdbc.update("INSERT INTO customization_reward_policies(revision,minimum_active_seconds,rare_unlock_seconds,"
                + "legendary_unlock_seconds,time_half_seconds,rare_max_bonus_ppm,legendary_max_bonus_ppm,"
                + "rewards_per_eligible_session,duplicates_allowed,location_weights,category_weights,"
                + "source_workbook_sha256) SELECT 3,minimum_active_seconds,rare_unlock_seconds,"
                + "legendary_unlock_seconds,time_half_seconds,rare_max_bonus_ppm,legendary_max_bonus_ppm,"
                + "rewards_per_eligible_session,duplicates_allowed,location_weights,category_weights,"
                + "source_workbook_sha256 FROM customization_reward_policies WHERE revision=2");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO customization_reward_pool_publications(publication_id,"
                + "approval_id,revision,previous_revision,before_product_ids,after_product_ids,request_digest,"
                + "approved_digest,approved_by,actor) VALUES(?,?,3,2,'[]','[]',?,?,'member-2','member-2')",
                UUID.randomUUID(), approvalId, "0".repeat(64), "0".repeat(64)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("같은 approvalId·publicationId 재시도는 같은 결과이고 다른 요청이면 409 다")
    void retriesAreIdempotentAndForeignRequestsConflict() {
        List<String> next = withoutOne("common", "head");
        UUID approvalId = UUID.randomUUID();
        var approval = pool.approve(approvalId, approve(2, next), "member-2");
        assertThat(pool.approve(approvalId, approve(2, next), "member-2")).isEqualTo(approval);
        assertThatThrownBy(() -> pool.approve(approvalId, approve(2, next), "member-3"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> pool.approve(approvalId, approve(7, next), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");

        UUID publicationId = UUID.randomUUID();
        PublishRequest request = publish(approvalId, 2, next);
        var published = pool.publish(publicationId, request, "member-1");
        assertThat(pool.publish(publicationId, request, "member-1")).isEqualTo(published);
        assertThat(maxRevision()).as("재시도가 revision 을 더 올리지 않는다").isEqualTo(3);
        assertThat(count("customization_reward_pool_publications")).isEqualTo(1);

        assertThatThrownBy(() -> pool.publish(publicationId, request, "member-3"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> pool.publish(UUID.randomUUID(), request, "member-1"))
                .as("이미 쓴 승인").isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
    }

    @Test
    @DisplayName("취소된 승인으로 발행하면 409 이고, 이미 취소된 승인의 DELETE 는 204 가 두 번이다")
    void revokedApprovalCannotPublish() throws Exception {
        List<String> next = withoutOne("common", "head");
        UUID approvalId = UUID.randomUUID();
        pool.approve(approvalId, approve(2, next), "member-2");

        mvc.perform(delete(BASE + "/reward-pool/approvals/{id}", approvalId).header("Authorization", MEMBER_1))
                .andExpect(status().isNoContent());
        mvc.perform(delete(BASE + "/reward-pool/approvals/{id}", approvalId).header("Authorization", MEMBER_1))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("SELECT revoked_by FROM customization_reward_pool_approvals"
                + " WHERE approval_id=?", String.class, approvalId)).isEqualTo("member-1");

        assertThatThrownBy(() -> pool.publish(UUID.randomUUID(), publish(approvalId, 2, next), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> pool.approve(approvalId, approve(2, next), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        mvc.perform(delete(BASE + "/reward-pool/approvals/{id}", UUID.randomUUID()).header("Authorization", MEMBER_1))
                .andExpect(status().isNotFound());
        assertThat(maxRevision()).isEqualTo(2);

        // 발행에 쓴 승인은 취소할 수 없다.
        UUID used = UUID.randomUUID();
        pool.approve(used, approve(2, next), "member-2");
        pool.publish(UUID.randomUUID(), publish(used, 2, next), "member-1");
        mvc.perform(delete(BASE + "/reward-pool/approvals/{id}", used).header("Authorization", MEMBER_1))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("지문이 맞지 않으면 승인도 발행도 409 다 — 승인한 풀과 다른 풀은 발행되지 않는다")
    void digestMismatchConflicts() {
        List<String> next = withoutOne("common", "head");
        assertThatThrownBy(() -> pool.approve(UUID.randomUUID(),
                new ApproveRequest(2, next, "0".repeat(64)), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");

        UUID approvalId = UUID.randomUUID();
        pool.approve(approvalId, approve(2, next), "member-2");
        List<String> other = withoutOne("uncommon", "neck");
        assertThatThrownBy(() -> pool.publish(UUID.randomUUID(),
                new PublishRequest(approvalId, 2, next, digest(other)), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> pool.publish(UUID.randomUUID(), publish(approvalId, 2, other), "member-1"))
                .as("승인 스냅샷과 다른 풀").isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("409");
        assertThat(maxRevision()).isEqualTo(2);
    }

    @Test
    @DisplayName("expectedRevision 이 현재와 다르면 409 이고, 같은 revision 의 동시 발행 둘 중 하나만 성공한다")
    void staleRevisionAndConcurrentPublishConflict() throws Exception {
        List<String> next = withoutOne("common", "head");
        assertThatThrownBy(() -> pool.approve(UUID.randomUUID(), approve(1, next), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        UUID wrong = UUID.randomUUID();
        pool.approve(wrong, approve(2, next), "member-2");
        assertThatThrownBy(() -> pool.publish(UUID.randomUUID(), publish(wrong, 1, next), "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");

        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        pool.approve(first, approve(2, next), "member-2");
        pool.approve(second, approve(2, next), "member-3");
        var executor = Executors.newFixedThreadPool(2);
        try {
            var a = executor.submit(() -> outcome(publish(first, 2, next)));
            var b = executor.submit(() -> outcome(publish(second, 2, next)));
            assertThat(List.of(a.get(20, TimeUnit.SECONDS), b.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("published", "conflict");
        } finally {
            executor.shutdownNow();
        }
        assertThat(count("customization_reward_pool_publications")).isEqualTo(1);
        assertThat(maxRevision()).isEqualTo(3);
    }

    @Test
    @DisplayName("빈 칸이 생기는 풀·신발·뗏목·없는 상품·빈 목록·정렬 안 됨·중복은 400 이고 아무것도 쓰지 않는다")
    void invalidPoolsAreRejectedWith400() throws Exception {
        List<String> full = currentPool();
        List<String> noLegendaryHead = new ArrayList<>(full);
        noLegendaryHead.removeAll(productsAt(2, "head", "legendary"));
        List<String> shoes = new ArrayList<>(full);
        shoes.add(oneProduct("shoes"));
        List<String> raft = new ArrayList<>(full);
        raft.add(oneProduct("canopy"));
        List<String> unknown = new ArrayList<>(full);
        unknown.add("zzz.unknown");

        for (List<String> invalid : List.of(noLegendaryHead, shoes, raft, unknown)) {
            List<String> sorted = new ArrayList<>(new TreeSet<>(invalid));
            postApproval(UUID.randomUUID(), 2, sorted, digest(sorted), MEMBER_2).andExpect(status().isBadRequest());
        }
        postApproval(UUID.randomUUID(), 2, List.of(), digest(List.of()), MEMBER_2).andExpect(status().isBadRequest());
        List<String> unsorted = new ArrayList<>(full);
        java.util.Collections.reverse(unsorted);
        postApproval(UUID.randomUUID(), 2, unsorted, digest(unsorted), MEMBER_2).andExpect(status().isBadRequest());
        List<String> duplicated = new ArrayList<>(full);
        duplicated.add(1, full.get(0));
        postApproval(UUID.randomUUID(), 2, duplicated, digest(duplicated), MEMBER_2)
                .andExpect(status().isBadRequest());

        // 승인한 풀과 다른(빈 칸이 생기는) 풀은 발행 쪽에서도 막힌다.
        UUID approvalId = UUID.randomUUID();
        pool.approve(approvalId, approve(2, full), "member-2");
        List<String> hollow = new ArrayList<>(noLegendaryHead);
        mvc.perform(put(BASE + "/reward-pool/publications/{id}", UUID.randomUUID()).header("Authorization", MEMBER_1)
                        .contentType("application/json")
                        .content(publishJson(approvalId, 2, hollow, digest(hollow))))
                .andExpect(status().is4xxClientError());

        assertThat(count("customization_reward_pool_approvals")).isEqualTo(1);
        assertThat(count("customization_reward_pool_publications")).isZero();
        assertThat(maxRevision()).isEqualTo(2);
    }

    // ------------------------------------------------------------------ 발행 결과

    @Test
    @DisplayName("발행하면 revision 3 이 생기고 정책 열은 revision 2 와 같으며 아이템 행은 원래 행의 복사본이다")
    void publicationCopiesPolicyAndItemRows() throws Exception {
        List<String> next = withoutOne("common", "head");
        String removed = new ArrayList<>(currentPool().stream().filter(p -> !next.contains(p)).toList()).get(0);
        UUID approvalId = UUID.randomUUID();
        UUID publicationId = UUID.randomUUID();
        postApproval(approvalId, 2, next, digest(next), MEMBER_2).andExpect(status().isOk())
                .andExpect(jsonPath("$.approvedBy").value("member-2"));
        mvc.perform(put(BASE + "/reward-pool/publications/{id}", publicationId).header("Authorization", MEMBER_1)
                        .contentType("application/json")
                        .content(publishJson(approvalId, 2, next, digest(next))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(3))
                .andExpect(jsonPath("$.previousRevision").value(2))
                .andExpect(jsonPath("$.actor").value("member-1"))
                .andExpect(jsonPath("$.approvedBy").value("member-2"))
                .andExpect(jsonPath("$.productIds.length()").value(next.size()))
                .andExpect(jsonPath("$.previousProductIds.length()").value(next.size() + 1));

        assertThat(maxRevision()).isEqualTo(3);
        assertThat(policyColumns(3)).isEqualTo(policyColumns(2));
        assertThat(jdbc.queryForList("SELECT product_id FROM customization_reward_items WHERE revision=3"
                + " ORDER BY product_id", String.class)).isEqualTo(next);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items n"
                + " JOIN customization_reward_items o ON o.revision=2 AND o.product_id=n.product_id"
                + " WHERE n.revision=3 AND n.render_data=o.render_data AND n.source_asset_id=o.source_asset_id"
                + " AND n.category=o.category AND n.rarity=o.rarity AND n.rarity_reason=o.rarity_reason"
                + " AND n.sort_order=o.sort_order", Integer.class)).isEqualTo(next.size());
        assertThat(count("customization_reward_items WHERE revision=2")).as("기존 revision 은 그대로").isEqualTo(20);
        assertThat(jdbc.queryForObject("SELECT before_product_ids::text FROM customization_reward_pool_publications"
                + " WHERE publication_id=?", String.class, publicationId)).contains(removed);

        mvc.perform(get(BASE + "/reward-pool").header("Authorization", MEMBER_1))
                .andExpect(status().isOk()).andExpect(jsonPath("$.current.revision").value(3))
                .andExpect(jsonPath("$.current.productIds.length()").value(next.size()))
                .andExpect(jsonPath("$.history.length()").value(1))
                .andExpect(jsonPath("$.history[0].publicationId").value(publicationId.toString()))
                .andExpect(jsonPath("$.history[0].productIds.length()").value(next.size()))
                .andExpect(jsonPath("$.history[0].productIds[0]").value(next.get(0)))
                .andExpect(jsonPath("$.history[0].previousProductIds.length()").value(next.size() + 1));
        // 같은 publicationId 재시도는 200 이고 본문이 같다 — 저장된 배열을 다시 읽는다.
        String first = mvc.perform(put(BASE + "/reward-pool/publications/{id}", publicationId)
                        .header("Authorization", MEMBER_1).contentType("application/json")
                        .content(publishJson(approvalId, 2, next, digest(next))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(3))
                .andExpect(jsonPath("$.productIds.length()").value(next.size()))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(first).contains(removed);
        assertThat(jdbc.queryForObject("SELECT jsonb_typeof(after_product_ids) FROM"
                + " customization_reward_pool_publications WHERE publication_id=?", String.class, publicationId))
                .isEqualTo("array");

        // 뺐던 상품을 다시 넣는다 — 그 상품이 들어 있는 가장 큰 revision(2)의 행이 복사된다.
        UUID back = UUID.randomUUID();
        List<String> all = currentPoolAt(2);
        pool.approve(back, approve(3, all), "member-3");
        assertThat(pool.publish(UUID.randomUUID(), publish(back, 3, all), "member-1").revision()).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items n"
                + " JOIN customization_reward_items o ON o.revision=2 AND o.product_id=n.product_id"
                + " WHERE n.revision=4 AND n.render_data=o.render_data", Integer.class)).isEqualTo(all.size());
    }

    @Test
    @DisplayName("발행 뒤 정산은 새 revision 으로 뽑고 뺀 상품은 뽑히지 않으며, 뺀 상품도 카탈로그에는 남는다")
    void settlementUsesTheNewRevisionAndCatalogKeepsRemovedItems() throws Exception {
        List<String> full = currentPool();
        Set<String> before = sweep();
        // 뽑힌 일반 머리 중 같은 칸에 다른 상품이 남는 것 하나를 뺀다.
        String removed = before.stream().filter(p -> productsAt(2, "head", "common").contains(p)).sorted()
                .findFirst().orElseThrow();
        assertThat(productsAt(2, "head", "common").size()).isGreaterThan(1);
        List<String> next = new ArrayList<>(full);
        next.remove(removed);
        UUID approvalId = UUID.randomUUID();
        pool.approve(approvalId, approve(2, next), "member-2");
        pool.publish(UUID.randomUUID(), publish(approvalId, 2, next), "member-1");

        UUID user = newUser();
        Set<String> after = new TreeSet<>();
        for (int i = 0; i < 400; i++) {
            when(random.nextDouble()).thenReturn(i / 400.0);
            CustomizationRewardResult won = tx.execute(status -> rewards.settle(user, UUID.randomUUID(),
                    FocusSessionKind.ISLAND, 3600, Instant.now())).orElseThrow();
            assertThat(won.revision()).isEqualTo(3);
            after.add(won.productId());
        }
        assertThat(after).doesNotContain(removed).isSubsetOf(next);
        assertThat(after.size()).isGreaterThan(1);

        mvc.perform(get("/internal/customization/catalog").header("Authorization", BUSINESS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.productId=='" + removed + "')]").isNotEmpty());
    }

    // ------------------------------------------------------------------ 아이템 현황

    @Test
    @DisplayName("items 는 보유자 수·풀 포함·표시 가능 여부를 맞게 센다 — 신발은 표시 불가, 정적 행은 그림·퇴역을 덮는다")
    void itemsReportOwnersPoolMembershipAndDisplayability() throws Exception {
        List<String> full = currentPool();
        String head = full.stream().filter(p -> p.startsWith("cust.head.")).findFirst().orElseThrow();
        String shoes = oneProduct("shoes");
        for (int i = 0; i < 3; i++) {
            jdbc.update("INSERT INTO owned_products(id,owner_type,user_id,product_id,granted_ref) VALUES(?,?,?,?,?)",
                    UUID.randomUUID(), "user", newUser(), head, "test");
        }
        jdbc.update("INSERT INTO owned_products(id,owner_type,user_id,product_id,granted_ref) VALUES(?,?,?,?,?)",
                UUID.randomUUID(), "user", newUser(), shoes, "test");
        // 정적 전용 상품 하나, 그리고 보상 상품 하나의 정적 행(그림·퇴역을 덮는다).
        jdbc.update("INSERT INTO catalog_assets(product_id,title,kind,owner_type) VALUES('pooltest.clothes','정적 옷','clothes','user')");
        jdbc.update("INSERT INTO customization_asset_meta(product_id,kind,slot,image_path,width,height,anchor_x,anchor_y,"
                + "sort_order) VALUES('pooltest.clothes','clothes','clothes','/static/pooltest.png',10,10,0.5,0.5,0)");
        jdbc.update("INSERT INTO customization_asset_meta(product_id,kind,slot,image_path,width,height,anchor_x,anchor_y,"
                + "sort_order,retired_at) SELECT product_id,kind,kind,'/static/override.png',10,10,0.5,0.5,0,now()"
                + " FROM catalog_assets WHERE product_id=?", head);

        String body = mvc.perform(get(BASE + "/items").header("Authorization", MEMBER_1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pool.revision").value(2))
                .andExpect(jsonPath("$.pool.categoryWeights.head").value(1))
                .andExpect(jsonPath("$.pool.productIds.length()").value(20))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        com.fasterxml.jackson.databind.JsonNode root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(body);
        Map<String, com.fasterxml.jackson.databind.JsonNode> byId = new java.util.HashMap<>();
        root.get("items").forEach(item -> byId.put(item.get("productId").asText(), item));

        for (var item : byId.values()) {
            assertThat(item.get("ownerCount").asLong()).as(item.get("productId").asText())
                    .isEqualTo(jdbc.queryForObject("SELECT count(*) FROM owned_products WHERE owner_type='user'"
                            + " AND product_id=?", Long.class, item.get("productId").asText()));
        }
        assertThat(byId.get(head).get("ownerCount").asInt()).isEqualTo(3);
        assertThat(byId.get(head).get("inPool").asBoolean()).isTrue();
        assertThat(byId.get(head).get("displayable").asBoolean()).isTrue();
        assertThat(byId.get(head).get("imagePath").asText()).isEqualTo("/static/override.png");
        assertThat(byId.get(head).get("retiredAt").isNull()).isFalse();
        assertThat(byId.get(head).get("rarity").asText()).isNotEmpty();
        assertThat(byId.get(shoes).get("ownerCount").asInt()).isEqualTo(1);
        assertThat(byId.get(shoes).get("inPool").asBoolean()).isFalse();
        assertThat(byId.get(shoes).get("displayable").asBoolean()).isFalse();
        assertThat(byId.get("pooltest.clothes").get("category").isNull()).isTrue();
        assertThat(byId.get("pooltest.clothes").get("displayable").asBoolean()).isTrue();
        assertThat(byId.get("pooltest.clothes").get("inPool").asBoolean()).isFalse();
        assertThat(byId.get("pooltest.clothes").get("imagePath").asText()).isEqualTo("/static/pooltest.png");
        long inPool = byId.values().stream().filter(i -> i.get("inPool").asBoolean()).count();
        assertThat(inPool).isEqualTo(20);

        List<String> order = new ArrayList<>();
        root.get("items").forEach(i -> order.add(i.get("kind").asText() + "/" + String.format("%09d",
                i.get("sortOrder").asInt()) + "/" + i.get("productId").asText()));
        assertThat(order).isSorted();
    }

    @Test
    @DisplayName("business 토큰으로 새 경로를 부르면 403 이다")
    void businessTokenIsForbidden() throws Exception {
        List<String> full = currentPool();
        UUID id = UUID.randomUUID();
        mvc.perform(get(BASE + "/items").header("Authorization", BUSINESS)).andExpect(status().isForbidden());
        mvc.perform(get(BASE + "/reward-pool").header("Authorization", BUSINESS)).andExpect(status().isForbidden());
        postApproval(id, 2, full, digest(full), BUSINESS).andExpect(status().isForbidden());
        mvc.perform(delete(BASE + "/reward-pool/approvals/{id}", id).header("Authorization", BUSINESS))
                .andExpect(status().isForbidden());
        mvc.perform(put(BASE + "/reward-pool/publications/{id}", id).header("Authorization", BUSINESS)
                        .contentType("application/json").content(publishJson(id, 2, full, digest(full))))
                .andExpect(status().isForbidden());
        assertThat(count("customization_reward_pool_approvals")).isZero();
    }

    // ------------------------------------------------------------------ 도구

    private Set<String> sweep() {
        UUID user = newUser();
        Set<String> drawn = new TreeSet<>();
        for (int i = 0; i < 400; i++) {
            when(random.nextDouble()).thenReturn(i / 400.0);
            drawn.add(tx.execute(status -> rewards.settle(user, UUID.randomUUID(), FocusSessionKind.ISLAND, 3600,
                    Instant.now())).orElseThrow().productId());
        }
        return drawn;
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(UUID.randomUUID().toString()).accessToken());
    }

    private String outcome(PublishRequest request) {
        try {
            pool.publish(UUID.randomUUID(), request, "member-1");
            return "published";
        } catch (ResponseStatusException e) {
            assertThat(e.getStatusCode().value()).isEqualTo(409);
            return "conflict";
        }
    }

    private org.springframework.test.web.servlet.ResultActions postApproval(UUID id, int revision,
            List<String> ids, String digest, String token) throws Exception {
        return mvc.perform(post(BASE + "/reward-pool/approvals/{id}", id).header("Authorization", token)
                .contentType("application/json")
                .content("{\"expectedRevision\":" + revision + ",\"productIds\":" + json(ids)
                        + ",\"approvedDigest\":\"" + digest + "\"}"));
    }

    private static String publishJson(UUID approvalId, int revision, List<String> ids, String digest) {
        return "{\"approvalId\":\"" + approvalId + "\",\"expectedRevision\":" + revision + ",\"productIds\":"
                + json(ids) + ",\"approvedDigest\":\"" + digest + "\"}";
    }

    private static String json(List<String> ids) {
        return "[" + String.join(",", ids.stream().map(id -> "\"" + id + "\"").toList()) + "]";
    }

    private static ApproveRequest approve(int revision, List<String> ids) {
        return new ApproveRequest(revision, ids, digest(ids));
    }

    private static PublishRequest publish(UUID approvalId, int revision, List<String> ids) {
        return new PublishRequest(approvalId, revision, ids, digest(ids));
    }

    private static String digest(List<String> ids) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(
                    CustomizationRewardPoolAdminService.canonical(ids).getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<String> currentPool() {
        return currentPoolAt(maxRevision());
    }

    private List<String> currentPoolAt(int revision) {
        return jdbc.queryForList("SELECT product_id FROM customization_reward_items WHERE revision=?"
                + " ORDER BY product_id", String.class, revision);
    }

    private List<String> productsAt(int revision, String category, String rarity) {
        return jdbc.queryForList("SELECT product_id FROM customization_reward_items WHERE revision=? AND category=?"
                + " AND rarity=? ORDER BY product_id", String.class, revision, category, rarity);
    }

    /** 현재 풀에서 같은 (분류·등급) 칸에 다른 상품이 남는 상품 하나를 뺀 풀. */
    private List<String> withoutOne(String rarity, String category) {
        List<String> cell = productsAt(2, category, rarity);
        assertThat(cell.size()).as("칸에 둘 이상 있어야 하나를 뺄 수 있다").isGreaterThan(1);
        List<String> next = new ArrayList<>(currentPoolAt(2));
        next.remove(cell.get(0));
        return next;
    }

    private String oneProduct(String category) {
        return jdbc.queryForObject("SELECT product_id FROM customization_reward_items WHERE category=?"
                + " ORDER BY product_id LIMIT 1", String.class, category);
    }

    private String policyColumns(int revision) {
        return jdbc.queryForObject("SELECT (to_jsonb(p) - 'revision' - 'created_at')::text"
                + " FROM customization_reward_policies p WHERE revision=?", String.class, revision);
    }

    private int maxRevision() {
        return jdbc.queryForObject("SELECT max(revision) FROM customization_reward_policies", Integer.class);
    }

    private long count(String tableAndWhere) {
        return jdbc.queryForObject("SELECT count(*) FROM " + tableAndWhere, Long.class);
    }
}
