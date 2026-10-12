package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusFinishView;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.SeaSessionPredicate;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;

/**
 * 바다 집중 seam (GROMO-2274, 결정 N3) — 집중 종료의 정산이 {@link SeaSessionPredicate} 판정을 따라 갈리는지
 * <b>실제 Flyway PostgreSQL</b> 위에서 본다.
 *
 * <p>서버에는 바다 집중 세션이 없어(E1-1 몫) 판정은 운영에서 늘 {@code false} 다. 그래서 이 클래스가 판정을
 * {@code true} 로 바꾸는 <b>유일한</b> 자리다 — 스파이 한 개로 판정만 뒤집고, 세션·정산·지갑·인벤토리는 전부 진짜
 * 경로를 탄다. 판정이 {@code false} 인 쪽(운영 그대로)은 같은 시나리오를 섬 세션으로 돌려 «섬 통장 적립 그대로,
 * seaReward 는 null» 을 고정한다.
 *
 * <p>분당 적립 크론({@code focus.reward.accrual-enabled})은 기본값(꺼짐)으로 둔다 — 지급 경로를 finish 의
 * 마지막 확정 하나로 좁혀, 통장 잔액 단언이 크론 시각에 흔들리지 않게 한다.
 */
@SpringBootTest
class SeaSessionSeamIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
    }

    @MockitoSpyBean
    SeaSessionPredicate seaSessions;
    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;

    /** 단계표(전역 {@code base} 세트)는 테스트 사이에 새지 않게 비운다 — 이 컨텍스트의 DB 는 이 클래스만 쓴다. */
    @BeforeEach
    void emptyTiers() {
        jdbc.update("delete from sea_reward_tiers");
    }

    @Test
    @DisplayName("바다 판정이면 섬 통장은 잔액도 원장도 그대로이고, 누적·단계표 보상이 정산돼 seaReward 가 채워진다")
    void seaSessionSettlesThroughTheEngineAndLeavesTheIslandWalletAlone() {
        doReturn(true).when(seaSessions).isSea(any());
        UUID user = newUser();
        UUID island = newIsland(user, "바다판정섬");
        String scarf = product("clothes");
        String hat = product("decor");
        tier("base", 30, scarf);
        tier("base", 90, hat);
        long balanceBefore = islandBalance(island);
        long ledgerBefore = ledgerRows(island);

        FocusSessionView started = start(user, island);
        backdate(started.id(), 40 * 60);
        UUID key = UUID.randomUUID();
        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), key);

        assertThat(finished.seaReward()).as("바다 세션은 아무것도 못 받아도 객체다").isNotNull();
        assertThat(finished.seaReward().grantedProductIds()).as("40분 → 30분 단계를 넘었다").containsExactly(scarf);
        assertThat(finished.seaReward().minutesToNextTier()).as("90분 단계까지 50분").isEqualTo(50);
        assertThat(finished.activeSeconds()).isBetween(2400L, 2460L);

        assertThat(islandBalance(island)).as("village_points 잔액 불변").isEqualTo(balanceBefore);
        assertThat(ledgerRows(island)).as("원장 불변").isEqualTo(ledgerBefore);
        assertThat(count("select count(*) from focus_reward_accruals where session_id=?", started.id()))
                .as("적립 행도 없다").isZero();
        assertThat(finished.earnedFish()).isZero();
        assertThat(finished.allocation().personalFishAdded()).isZero();
        assertThat(finished.allocation().constructionFishAdded()).isZero();

        assertThat(jdbc.queryForMap("select lifetime_seconds, month_seconds from sea_focus_totals where user_id=?",
                user)).containsEntry("lifetime_seconds", finished.activeSeconds())
                .containsEntry("month_seconds", finished.activeSeconds());
        assertThat(jdbc.queryForList("select product_id from owned_products where user_id=?", String.class, user))
                .containsExactly(scarf);
        // 일 집계·정산 행·세션 종결은 섬 세션과 같게 간다 — 통장만 건드리지 않는다.
        assertThat(count("select coalesce(sum(total_focus_seconds),0) from daily_focus_stats where user_id=?", user))
                .isEqualTo(finished.activeSeconds());
        assertThat(jdbc.queryForObject("select lifecycle from focus_session_details where session_id=?",
                String.class, started.id())).isEqualTo("COMPLETED");
        assertThat(count("select count(*) from focus_settlements where session_id=? and earned_fish=0",
                started.id())).isEqualTo(1);

        // 같은 키의 재시도는 receipt 가 원 응답(seaReward 포함)을 그대로 돌려주고 누적을 다시 더하지 않는다.
        FocusFinishView replayed = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), key);
        assertThat(replayed).isEqualTo(finished);
        // 새 키로 다시 끝내면 정산 행에서 응답을 다시 만들 뿐이다 — 받은 상품은 저장하지 않아 seaReward 는 null 이고
        // (E1-1 이 자동 종료 결과에도 상품을 보여 주려면 저장 자리를 정해야 한다), 누적은 역시 다시 더하지 않는다.
        FocusFinishView again = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        assertThat(again.seaReward()).isNull();
        assertThat(again.activeSeconds()).isEqualTo(finished.activeSeconds());
        assertThat(jdbc.queryForObject("select lifetime_seconds from sea_focus_totals where user_id=?", Long.class,
                user)).isEqualTo(finished.activeSeconds());
        assertThat(jdbc.queryForList("select product_id from owned_products where user_id=?", String.class, user))
                .containsExactly(scarf);
    }

    @Test
    @DisplayName("바다 판정이 false 면(운영 그대로) seaReward 는 null 이고 섬 통장 적립·누적 없음이 종전 그대로다")
    void islandSessionKeepsTheExistingAccrualAndHasNoSeaReward() {
        UUID user = newUser();
        UUID island = newIsland(user, "섬세션섬");
        String scarf = product("clothes");
        tier("base", 30, scarf);

        FocusSessionView started = start(user, island);
        backdate(started.id(), 40 * 60);
        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        assertThat(finished.seaReward()).as("섬 세션은 null").isNull();
        assertThat(finished.earnedFish()).as("40분 → 40마리").isEqualTo(40);
        assertThat(finished.allocation().constructionFishAdded()).isEqualTo(40);
        assertThat(islandBalance(island)).as("섬 통장 적립 그대로").isEqualTo(40);
        assertThat(count("select coalesce(sum(earned_fish),0) from focus_reward_accruals where session_id=?",
                started.id())).isEqualTo(40);
        assertThat(count("select count(*) from sea_focus_totals where user_id=?", user))
                .as("누적 행을 만들지 않는다").isZero();
        assertThat(count("select count(*) from owned_products where user_id=?", user))
                .as("단계표 상품을 주지 않는다").isZero();
    }

    // ---------------------------------------------------------------- 도우미

    private FocusSessionView start(UUID user, UUID island) {
        return focus.start(user, new FocusSessionStartCommandRequest(island, "알고리즘", 25), UUID.randomUUID());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private UUID newIsland(UUID owner, String name) {
        return islands.create(owner, new CreateIslandCommandRequest(name, null, false, null), UUID.randomUUID()).id();
    }

    private String product(String kind) {
        String productId = kind + "-" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.update("insert into catalog_assets (product_id, title, kind, owner_type, created_at) "
                + "values (?, ?, ?, 'user', now())", productId, productId, kind);
        return productId;
    }

    private void tier(String setKey, int minutes, String productId) {
        jdbc.update("insert into sea_reward_tiers (set_key, threshold_minutes, product_id) values (?, ?, ?)",
                setKey, minutes, productId);
    }

    /** 방금 시작한 세션을 {@code seconds} 전에 시작한 것으로 옮긴다 — 실제 시계를 기다리지 않고 정산 값을 본다. */
    private void backdate(UUID sessionId, long seconds) {
        Timestamp at = Timestamp.from(Instant.now().minusSeconds(seconds));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, sessionId);
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, sessionId);
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at,
                sessionId);
    }

    private long islandBalance(UUID islandId) {
        return count("select coalesce(sum(balance),0) from island_wallets where island_id=?", islandId);
    }

    private long ledgerRows(UUID islandId) {
        return count("select count(*) from island_wallet_transactions where island_id=?", islandId);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
