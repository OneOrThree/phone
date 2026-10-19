package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.appearance.service.SeaFocusRewardService;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 계정 탈퇴 ↔ 바다 집중 누적 파기 (GROMO-2274 · 계약 §0 N42) — 사용자 행은 익명화만 되고 삭제되지 않아
 * {@code sea_focus_totals.user_id REFERENCES users ON DELETE CASCADE} 가 돌지 않는다. 탈퇴 트랜잭션이 직접 지우는지를
 * 실제 Flyway(V117) 스키마에서 고정한다: 탈퇴자의 누적은 0 행, 같은 시각에 쌓인 남의 누적은 그대로다.
 *
 * <p>지급된 상품({@code owned_products})은 이 서비스의 파기가 아니라 기존 {@code AppearanceService#eraseWithdrawnUser}
 * 몫이다 — 같은 탈퇴 한 번에 함께 사라지는지도 본다(바다 쪽에서 따로 지우지 않아도 남지 않는다는 근거).
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
    SeaFocusRewardService sea;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager transactions;

    @Test
    @DisplayName("탈퇴하면 그 유저의 바다 누적은 0 행이 되고 지급된 상품도 남지 않는다 — 남의 누적·상품은 그대로다")
    void withdrawalDeletesOnlyTheWithdrawnUsersSeaTotals() {
        UUID leaver = newUser();
        UUID bystander = newUser();
        String scarf = product();
        jdbc.update("insert into sea_reward_tiers (set_key, threshold_minutes, product_id) values ('base', 10, ?)",
                scarf);
        settle(leaver, 1800);
        settle(bystander, 1800);
        assertThat(totalsOf(leaver)).as("탈퇴 전에는 누적이 있다").isEqualTo(1);
        assertThat(ownedOf(leaver)).isEqualTo(1);

        withdrawal.withdraw(leaver);

        assertThat(totalsOf(leaver)).as("탈퇴자의 누적은 0 행").isZero();
        assertThat(ownedOf(leaver)).as("지급된 상품은 외양 도메인의 파기가 지운다").isZero();
        assertThat(totalsOf(bystander)).as("남의 누적은 그대로").isEqualTo(1);
        assertThat(jdbc.queryForObject("select lifetime_seconds from sea_focus_totals where user_id=?", Long.class,
                bystander)).isEqualTo(1800L);
        assertThat(ownedOf(bystander)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from sea_reward_tiers", Integer.class))
                .as("단계표는 운영 카탈로그라 정리 대상이 아니다").isEqualTo(1);
    }

    /** 바다 집중이 끝난 것처럼 정산한다 — 서버에 바다 세션이 없어(E1-1) 엔진을 직접 부른다. */
    private void settle(UUID user, long seconds) {
        new TransactionTemplate(transactions).executeWithoutResult(
                status -> sea.settle(user, seconds, Instant.parse("2026-10-12T03:00:00Z")));
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
