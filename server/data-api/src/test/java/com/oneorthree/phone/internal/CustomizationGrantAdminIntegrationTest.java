package com.oneorthree.phone.internal;

import com.oneorthree.phone.common.id.UuidV7;
import com.oneorthree.phone.internal.service.CustomizationGrantAdminService;
import com.oneorthree.phone.internal.service.CustomizationGrantAdminService.ApproveRequest;
import com.oneorthree.phone.internal.service.CustomizationGrantAdminService.ExecuteRequest;
import com.oneorthree.phone.internal.service.CustomizationGrantAdminService.Execution;
import com.oneorthree.phone.internal.service.CustomizationGrantAdminService.Preview;
import com.oneorthree.phone.internal.service.CustomizationGrantAdminService.PreviewRequest;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 운영 Flyway 스키마에서 꾸미기 지급의 승인·실행·이어 하기·탈퇴 경합 규칙을 확인한다.
 * 한 요청의 시간 예산을 0 으로 두어, 200명을 넘는 대상이 여러 번의 RUNNING 응답으로 나뉘게 한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CustomizationGrantAdminIntegrationTest {
    private static final String PRODUCT = "gt.head.fixture";
    private static final String RETIRED = "gt.head.retired";
    private static final String REASON = "11월 출석 감사 선물";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.customization-grant.budget-millis", () -> "0");
        String[] routes = {
            "POST /internal/admin/customization/grants/previews",
            "POST /internal/admin/customization/grants/approvals/*",
            "DELETE /internal/admin/customization/grants/approvals/*",
            "PUT /internal/admin/customization/grants/executions/*",
            "GET /internal/admin/customization/grants/executions"};
        for (int i = 0; i < routes.length; i++) {
            String route = routes[i];
            registry.add("internal.api.callers.console.allow[" + i + "]", () -> route);
            registry.add("internal.api.callers.approver.allow[" + i + "]", () -> route);
        }
        registry.add("internal.api.callers.console.token", () -> "grant-test-console");
        registry.add("internal.api.callers.console.console-actor", () -> "member-1");
        registry.add("internal.api.callers.approver.token", () -> "grant-test-approver");
        registry.add("internal.api.callers.approver.console-actor", () -> "member-2");
        registry.add("internal.api.callers.business.token", () -> "grant-test-business");
        registry.add("internal.api.callers.business.allow[0]",
                () -> "POST /internal/admin/customization/grants/previews");
    }

    @Autowired CustomizationGrantAdminService grants;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired MockMvc mvc;

    @BeforeEach
    void reset() {
        jdbc.execute("DELETE FROM customization_grant_targets");
        jdbc.execute("DELETE FROM customization_grant_executions");
        jdbc.execute("DELETE FROM customization_grant_approvals");
        jdbc.execute("DELETE FROM owned_products WHERE product_id LIKE 'gt.%'");
        jdbc.execute("DELETE FROM owned_products WHERE user_id IN (SELECT id FROM users WHERE nickname LIKE 'gt-%')");
        jdbc.execute("DELETE FROM users WHERE nickname LIKE 'gt-%'");
        product(PRODUCT, null);
        product(RETIRED, Timestamp.from(Instant.parse("2026-01-01T00:00:00Z")));
    }

    @Test
    void 승인자와_실행자가_같으면_409이고_DB_CHECK도_막는다() {
        UUID alice = newUser("gt-Alice");
        Preview preview = preview("gt-Alice");
        UUID approvalId = UUID.randomUUID();
        grants.approve(approvalId, approve(preview), "member-2");

        assertThatThrownBy(() -> grants.execute(UUID.randomUUID(), new ExecuteRequest(approvalId, preview.digest()),
                "member-2")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThat(count("SELECT count(*) FROM customization_grant_executions")).isZero();
        assertThat(owned(alice)).isFalse();

        assertThatThrownBy(() -> jdbc.update("INSERT INTO customization_grant_executions(grant_id,approval_id,"
                + "request_digest,approved_by,actor,status,target_count,started_at) VALUES(?,?,?,?,?,'RUNNING',1,now())",
                UUID.randomUUID(), approvalId, "0".repeat(64), "member-2", "member-2"))
                .isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("distinct_actors");
    }

    @Test
    void 같은_ID_재시도는_행을_더_만들지_않고_다른_요청은_409다() {
        newUser("gt-Alice");
        Preview preview = preview("gt-Alice");
        UUID approvalId = UUID.randomUUID();
        var first = grants.approve(approvalId, approve(preview), "member-2");
        assertThat(grants.approve(approvalId, approve(preview), "member-2")).isEqualTo(first);
        assertThatThrownBy(() -> grants.approve(approvalId, approve(preview), "member-3"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");

        UUID grantId = UUID.randomUUID();
        ExecuteRequest request = new ExecuteRequest(approvalId, preview.digest());
        Execution done = grants.execute(grantId, request, "member-1");
        assertThat(done.status()).isEqualTo("COMPLETED");
        assertThat(grants.execute(grantId, request, "member-1")).isEqualTo(done);
        assertThat(count("SELECT count(*) FROM customization_grant_executions")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM owned_products WHERE product_id='" + PRODUCT + "'")).isEqualTo(1);
        // 다른 실행자의 같은 grantId, 같은 승인의 다른 grantId 는 모두 충돌이다.
        assertThatThrownBy(() -> grants.execute(grantId, request, "member-3"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> grants.execute(UUID.randomUUID(), request, "member-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThat(count("SELECT count(*) FROM customization_grant_executions")).isEqualTo(1);
    }

    @Test
    void 취소된_승인은_실행할_수_없고_실행에_쓴_승인은_취소할_수_없다() throws Exception {
        newUser("gt-Alice");
        Preview preview = preview("gt-Alice");
        UUID cancelled = UUID.randomUUID();
        grants.approve(cancelled, approve(preview), "member-2");
        mvc.perform(delete("/internal/admin/customization/grants/approvals/{id}", cancelled)
                .header("Authorization", "Bearer grant-test-console")).andExpect(status().isNoContent());
        mvc.perform(delete("/internal/admin/customization/grants/approvals/{id}", cancelled)
                .header("Authorization", "Bearer grant-test-console")).andExpect(status().isNoContent());
        assertThatThrownBy(() -> grants.execute(UUID.randomUUID(), new ExecuteRequest(cancelled, preview.digest()),
                "member-1")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> grants.approve(cancelled, approve(preview), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");

        UUID used = UUID.randomUUID();
        grants.approve(used, approve(preview), "member-2");
        grants.execute(UUID.randomUUID(), new ExecuteRequest(used, preview.digest()), "member-1");
        mvc.perform(delete("/internal/admin/customization/grants/approvals/{id}", used)
                .header("Authorization", "Bearer grant-test-console")).andExpect(status().isConflict());
        mvc.perform(delete("/internal/admin/customization/grants/approvals/{id}", UUID.randomUUID())
                .header("Authorization", "Bearer grant-test-console")).andExpect(status().isNotFound());
    }

    @Test
    void 지문_불일치_상품_불가_닉네임_중복은_거부하고_없는_닉네임은_지문이_없다() {
        newUser("gt-Alice");
        Preview preview = preview("gt-Alice");
        assertThatThrownBy(() -> grants.approve(UUID.randomUUID(), new ApproveRequest(PRODUCT, "USERS",
                preview.targets().stream().map(t -> t.userId()).toList(), REASON, "0".repeat(64)), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        // 사유가 바뀌면 같은 대상이어도 지문이 달라진다.
        assertThatThrownBy(() -> grants.approve(UUID.randomUUID(), new ApproveRequest(PRODUCT, "USERS",
                preview.targets().stream().map(t -> t.userId()).toList(), "다른 사유", preview.digest()), "member-2"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");

        for (String productId : List.of(RETIRED, "gt.head.not-in-catalog")) {
            assertThatThrownBy(() -> grants.preview(new PreviewRequest(productId, "USERS", List.of("gt-Alice"), REASON)))
                    .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        }
        assertThatThrownBy(() -> grants.preview(new PreviewRequest(PRODUCT, "USERS",
                List.of("gt-Alice", " GT-alice "), REASON)))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> grants.preview(new PreviewRequest(PRODUCT, "USERS", List.of("gt-Alice"), "줄\n바꿈")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");

        Preview partial = grants.preview(new PreviewRequest(PRODUCT, "USERS", List.of("gt-Alice", "gt-없는사람"), REASON));
        assertThat(partial.unknownNicknames()).containsExactly("gt-없는사람");
        assertThat(partial.digest()).isNull();
        assertThat(partial.targetCount()).isEqualTo(1);
    }

    @Test
    void 닉네임은_대소문자를_무시한_정확_일치만_찾는다() {
        UUID alice = newUser("gt-alice");
        Preview exact = grants.preview(new PreviewRequest(PRODUCT, "USERS", List.of(" GT-Alice "), REASON));
        assertThat(exact.targets()).singleElement().satisfies(t -> {
            assertThat(t.userId()).isEqualTo(alice);
            assertThat(t.nickname()).isEqualTo("gt-alice");
        });
        Preview partial = grants.preview(new PreviewRequest(PRODUCT, "USERS", List.of("gt-ali"), REASON));
        assertThat(partial.targets()).isEmpty();
        assertThat(partial.unknownNicknames()).containsExactly("gt-ali");
    }

    @Test
    void 새로_받은_사람만_보유_행과_인벤토리_사건을_갖는다() {
        UUID fresh = newUser("gt-fresh");
        UUID had = newUser("gt-had");
        ownDirectly(had);
        Preview preview = preview("gt-fresh", "gt-had");
        assertThat(preview.alreadyOwnedCount()).isEqualTo(1);
        assertThat(preview.newCount()).isEqualTo(1);
        UUID approvalId = UUID.randomUUID();
        grants.approve(approvalId, approve(preview), "member-2");
        UUID grantId = UUID.randomUUID();

        Execution done = grants.execute(grantId, new ExecuteRequest(approvalId, preview.digest()), "member-1");

        assertThat(done.status()).isEqualTo("COMPLETED");
        assertThat(done.completedAt()).isNotNull();
        assertThat(done.targetCount()).isEqualTo(2);
        assertThat(done.grantedCount()).isEqualTo(1);
        assertThat(done.alreadyOwnedCount()).isEqualTo(1);
        assertThat(done.skippedCount()).isZero();
        assertThat(count("SELECT count(*) FROM customization_grant_targets WHERE grant_id='" + grantId + "'"))
                .isEqualTo(2); // USERS 도 승인 스냅샷이 대상 표를 거친다
        assertThat(jdbc.queryForObject("SELECT granted_ref FROM owned_products WHERE user_id=? AND product_id=?",
                String.class, fresh, PRODUCT)).isEqualTo("admin-grant:" + grantId);
        assertThat(inventoryEvents(fresh)).isEqualTo(1);
        assertThat(inventoryEvents(had)).isZero();
    }

    @Test
    void 승인_뒤_탈퇴한_대상은_건너뛰고_승인_전_탈퇴는_승인이_409다() {
        UUID stays = newUser("gt-stays");
        UUID leaves = newUser("gt-leaves");
        Preview preview = preview("gt-stays", "gt-leaves");
        UUID approvalId = UUID.randomUUID();
        grants.approve(approvalId, approve(preview), "member-2");
        jdbc.update("UPDATE users SET is_deleted=true, nickname=NULL WHERE id=?", leaves);

        Execution done = grants.execute(UUID.randomUUID(), new ExecuteRequest(approvalId, preview.digest()), "member-1");

        assertThat(done.grantedCount()).isEqualTo(1);
        assertThat(done.skippedCount()).isEqualTo(1);
        assertThat(owned(stays)).isTrue();
        assertThat(owned(leaves)).isFalse();
        assertThat(inventoryEvents(leaves)).isZero();

        // 이미 탈퇴한 사람이 스냅샷에 있으면 승인 자체가 막힌다.
        assertThatThrownBy(() -> grants.approve(UUID.randomUUID(), approve(preview), "member-3"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
    }

    @Test
    void 전체_지급은_450명을_여러_번_나눠_중복과_누락없이_넣고_시작_뒤_가입자는_받지_않는다() {
        List<UUID> all = new ArrayList<>();
        for (int i = 0; i < 450; i++) {
            all.add(newUser(String.format("gt-bulk-%03d", i)));
        }
        for (int i = 0; i < 5; i++) {
            ownDirectly(all.get(i * 90));
        }
        jdbc.update("UPDATE users SET created_at=NULL WHERE id=?", all.get(1)); // 옛 행은 포함한다
        Preview preview = grants.preview(new PreviewRequest(PRODUCT, "ALL", List.of(), REASON));
        int target = preview.targetCount();
        assertThat(target).isGreaterThanOrEqualTo(450);
        assertThat(preview.alreadyOwnedCount()).isEqualTo(5);
        UUID approvalId = UUID.randomUUID();
        grants.approve(approvalId, new ApproveRequest(PRODUCT, "ALL", List.of(), REASON, preview.digest()), "member-2");
        UUID grantId = UUID.randomUUID();
        ExecuteRequest request = new ExecuteRequest(approvalId, preview.digest());

        Execution first = grants.execute(grantId, request, "member-1");
        assertThat(first.status()).isEqualTo("RUNNING");
        assertThat(first.completedAt()).isNull();
        UUID late = newUser("gt-late");
        // 가입 트랜잭션이 시작 시각 전에 행을 넣고 늦게 커밋한 경우를 흉내 낸다 — created_at 이 started_at 보다 이르다.
        UUID lateCommit = newUser("gt-late-commit");
        jdbc.update("UPDATE users SET created_at = now() - interval '1 hour' WHERE id=?", lateCommit);
        int calls = 1;
        Execution current = first;
        while (current.status().equals("RUNNING")) {
            current = grants.execute(grantId, request, "member-1");
            calls++;
            assertThat(calls).isLessThan(50);
        }

        assertThat(calls).isGreaterThanOrEqualTo((target + 199) / 200); // 200명 단위로 끊긴다
        assertThat(current.targetCount()).isEqualTo(target);
        assertThat(current.grantedCount() + current.alreadyOwnedCount() + current.skippedCount()).isEqualTo(target);
        assertThat(current.alreadyOwnedCount()).isEqualTo(5);
        assertThat(count("SELECT count(*) FROM owned_products WHERE product_id='" + PRODUCT + "'")).isEqualTo(target);
        assertThat(count("SELECT count(DISTINCT user_id) FROM owned_products WHERE product_id='" + PRODUCT + "'"))
                .isEqualTo(target);
        assertThat(owned(late)).isFalse();
        assertThat(owned(lateCommit)).isFalse();
        assertThat(count("SELECT count(*) FROM customization_grant_targets WHERE grant_id='" + grantId + "'"))
                .isEqualTo(target); // 반복 호출이 대상 행을 다시 넣지 않는다
        assertThat(owned(all.get(1))).isTrue();
        assertThat(count("SELECT count(*) FROM event_outbox WHERE type='inventory.updated' AND aggregate_id IN"
                + " (SELECT id::text FROM users WHERE nickname LIKE 'gt-bulk-%')")).isEqualTo(445);
        assertThat(grants.execute(grantId, request, "member-1")).isEqualTo(current);
    }

    @Test
    void 전체_지급_중_chunk_사이에_탈퇴한_대상도_건너뜀으로_세어_합계가_대상과_같다() {
        List<UUID> all = new ArrayList<>();
        for (int i = 0; i < 450; i++) {
            all.add(newUser(String.format("gt-wd-%03d", i)));
        }
        Preview preview = grants.preview(new PreviewRequest(PRODUCT, "ALL", List.of(), REASON));
        UUID approvalId = UUID.randomUUID();
        grants.approve(approvalId, new ApproveRequest(PRODUCT, "ALL", List.of(), REASON, preview.digest()), "member-2");
        UUID grantId = UUID.randomUUID();
        ExecuteRequest request = new ExecuteRequest(approvalId, preview.digest());

        Execution first = grants.execute(grantId, request, "member-1");
        assertThat(first.status()).isEqualTo("RUNNING");
        // 아직 처리되지 않은 사용자(첫 chunk 의 마지막 id 보다 뒤) 한 명이 chunk 사이에 탈퇴한다.
        UUID leaver = jdbc.queryForObject("SELECT id FROM users WHERE nickname LIKE 'gt-wd-%' AND id >"
                + " (SELECT cursor_user_id FROM customization_grant_executions WHERE grant_id=?)"
                + " ORDER BY id LIMIT 1", UUID.class, grantId);
        jdbc.update("UPDATE users SET is_deleted=true, nickname=NULL WHERE id=?", leaver);
        Execution current = first;
        int calls = 1;
        while (current.status().equals("RUNNING")) {
            current = grants.execute(grantId, request, "member-1");
            assertThat(++calls).isLessThan(50);
        }

        assertThat(current.skippedCount()).isEqualTo(1);
        assertThat(current.grantedCount() + current.alreadyOwnedCount() + current.skippedCount())
                .isEqualTo(current.targetCount());
        assertThat(owned(leaver)).isFalse();
    }

    @Test
    void business_토큰은_403이고_console_토큰은_최근_실행_목록을_읽는다() throws Exception {
        mvc.perform(post("/internal/admin/customization/grants/previews")
                        .header("Authorization", "Bearer grant-test-business")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"" + PRODUCT + "\",\"mode\":\"ALL\",\"nicknames\":[],\"reason\":\"x\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/internal/admin/customization/grants/executions")
                        .header("Authorization", "Bearer grant-test-console"))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mvc.perform(get("/internal/admin/customization/grants/executions?limit=0")
                        .header("Authorization", "Bearer grant-test-console"))
                .andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------- 픽스처

    private void product(String productId, Timestamp retiredAt) {
        jdbc.update("INSERT INTO catalog_assets(product_id,title,kind,owner_type) VALUES(?,?, 'head','user')"
                + " ON CONFLICT DO NOTHING", productId, "지급 시험 " + productId);
        jdbc.update("INSERT INTO customization_asset_meta(product_id,kind,slot,image_path,width,height,anchor_x,"
                + "anchor_y,sort_order,retired_at) VALUES(?, 'head','head','/static/x.png',10,10,0.5,0.5,0,?)"
                + " ON CONFLICT DO NOTHING", productId, retiredAt);
    }

    private UUID newUser(String nickname) {
        return users.save(User.builder().nickname(nickname).build()).getId();
    }

    private Preview preview(String... nicknames) {
        return grants.preview(new PreviewRequest(PRODUCT, "USERS", List.of(nicknames), REASON));
    }

    private static ApproveRequest approve(Preview preview) {
        return new ApproveRequest(preview.productId(), preview.mode(),
                preview.targets().stream().map(t -> t.userId()).toList(), preview.reason(), preview.digest());
    }

    private void ownDirectly(UUID userId) {
        jdbc.update("INSERT INTO owned_products(id,owner_type,user_id,product_id,granted_ref,granted_at)"
                + " VALUES(?,'user',?,?,'seed',now())", UuidV7.next(), userId, PRODUCT);
    }

    private boolean owned(UUID userId) {
        return count("SELECT count(*) FROM owned_products WHERE owner_type='user' AND user_id='" + userId
                + "' AND product_id='" + PRODUCT + "'") == 1;
    }

    private int inventoryEvents(UUID userId) {
        return count("SELECT count(*) FROM event_outbox WHERE type='inventory.updated'"
                + " AND aggregate_type='USER_INVENTORY' AND aggregate_id='" + userId + "'");
    }

    private int count(String sql) {
        Integer value = jdbc.queryForObject(sql, Integer.class);
        return value == null ? 0 : value;
    }
}
