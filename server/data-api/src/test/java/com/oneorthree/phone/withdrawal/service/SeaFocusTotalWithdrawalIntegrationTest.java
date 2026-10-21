package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 계정 탈퇴 ↔ 옛 바다 집중 누적 파기 (GROMO-2274 · 계약 §0 N42) — 사용자 행은 익명화만 되고 삭제되지 않아
 * {@code sea_focus_totals.user_id REFERENCES users ON DELETE CASCADE} 가 돌지 않는다. 탈퇴 트랜잭션이 직접 지우는지를
 * 실제 Flyway(V117) 스키마에서 고정한다: 탈퇴자의 누적은 0 행, 같은 시각에 쌓인 남의 누적은 그대로다.
 *
 * <p>누적 엔진은 GROMO-2301 에서 지웠지만 표와 지난 행은 DROP 전까지 남으므로 행을 SQL 로 심는다. 개인 보유 상품
 * ({@code owned_products})이 같은 탈퇴 한 번에 함께 사라지는지도 본다.
 */
@SpringBootTest
class SeaFocusTotalWithdrawalIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("탈퇴하면 그 유저의 바다 누적은 0 행이 되고 보유 상품도 남지 않는다 — 남의 누적·상품은 그대로다")
    void withdrawalDeletesOnlyTheWithdrawnUsersSeaTotals() {
        UUID leaver = newUser();
        UUID bystander = newUser();
        String scarf = product();
        for (UUID user : new UUID[] {leaver, bystander}) {
            jdbc.update("insert into sea_focus_totals (user_id, lifetime_seconds, month_key, month_seconds) "
                    + "values (?, 1800, '2026-10', 1800)", user);
            jdbc.update("insert into owned_products (id, owner_type, user_id, product_id, granted_ref) "
                    + "values (?, 'user', ?, ?, 'sea:base:10')", UUID.randomUUID(), user, scarf);
        }
        assertThat(totalsOf(leaver)).as("탈퇴 전에는 누적이 있다").isEqualTo(1);
        assertThat(ownedOf(leaver)).isEqualTo(1);

        withdrawal.withdraw(leaver);

        assertThat(totalsOf(leaver)).as("탈퇴자의 누적은 0 행").isZero();
        assertThat(ownedOf(leaver)).as("보유 상품은 외양 도메인의 파기가 지운다").isZero();
        assertThat(totalsOf(bystander)).as("남의 누적은 그대로").isEqualTo(1);
        assertThat(jdbc.queryForObject("select lifetime_seconds from sea_focus_totals where user_id=?", Long.class,
                bystander)).isEqualTo(1800L);
        assertThat(ownedOf(bystander)).isEqualTo(1);
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private String product() {
        String productId = "scarf-" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.update("insert into catalog_assets (product_id, title, kind, owner_type, created_at) "
                + "values (?, ?, 'clothes', 'user', now())", productId, productId);
        return productId;
    }

    private int totalsOf(UUID user) {
        return jdbc.queryForObject("select count(*) from sea_focus_totals where user_id=?", Integer.class, user);
    }

    private int ownedOf(UUID user) {
        return jdbc.queryForObject("select count(*) from owned_products where user_id=?", Integer.class, user);
    }
}
