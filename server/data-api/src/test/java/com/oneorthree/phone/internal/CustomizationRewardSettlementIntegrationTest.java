package com.oneorthree.phone.internal;

import com.oneorthree.phone.appearance.repository.CustomizationRewardItemRepository;
import com.oneorthree.phone.appearance.repository.CustomizationRewardPolicyRepository;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardPolicy;
import com.oneorthree.phone.appearance.support.CustomizationRewardDraw;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusFinishView;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.repository.domain.FocusSessionKind;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.TelescopePinService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 집중 꾸미기 보상 정산 (GROMO-2301) — 실제 Flyway(V133~V135) PostgreSQL 에서 finish·휴식 자동 종료가 아이템을
 * 정확히 1개 뽑고, 정산 행에 남긴 결과를 재조회가 그대로 돌려주는지 본다.
 *
 * <p>상품 id 는 박지 않는다 — 등록 데이터(V134)는 재생성될 수 있어 DB 의 정책·후보에서 읽는다. 몇몇 테스트가 후보 한
 * 줄짜리 revision 을 새로 심으므로(지금 정책 = 가장 큰 revision) 단언은 «그 세션의 정산 행이 가리키는 revision» 기준이다
 * — 테스트 순서와 무관하다. 정확한 초가 필요하면 휴식으로 ACTIVE 구간을 닫은 뒤 그 길이를 SQL 로 맞춘다
 * (시계를 고정하지 않는다).
 */
@SpringBootTest
class CustomizationRewardSettlementIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
    }

    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    TelescopePinService pins;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    CustomizationRewardPolicyRepository policies;
    @Autowired
    CustomizationRewardItemRepository items;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("섬 40분 — 머리·목 중 1개가 개인 인벤토리에 들어가고, 섬 통장 적립은 종전 그대로다")
    void islandFinishGrantsOneItemAndKeepsWalletAccrual() {
        UUID user = newUser();
        UUID island = newIsland(user);
        FocusSessionView started = start(user, island);
        backdate(started.id(), 40 * 60);

        FocusFinishView finished = finish(user, started.id(), started.version(), UUID.randomUUID());

        String won = onlyReward(finished);
        assertThat(finished.seaReward().minutesToNextTier()).isNull();
        assertThat(finished.seaReward().newProductIds()).as("첫 당첨 — NEW!").containsExactly(won);
        assertThat(settledReward(started.id())).containsEntry("customization_reward_product_id", won)
                .containsEntry("customization_reward_new", true);
        assertThat(rewardCategory(started.id())).isIn("head", "neck");
        assertThat(owned(user)).containsExactly(won);
        assertThat(jdbc.queryForObject("select granted_ref from owned_products where user_id=?", String.class, user))
                .isEqualTo("focus:" + started.id());
        assertThat(inventoryEvents(user)).isEqualTo(1);
        assertThat(finished.earnedFish()).as("40분 → 40마리").isEqualTo(40);
        assertThat(islandBalance(island)).as("섬 통장 적립 그대로").isEqualTo(40);
    }

    @Test
    @DisplayName("바다 40분 — 1개를 받고 섬 통장은 건드리지 않는다")
    void seaFinishGrantsOneItemWithoutWallet() {
        UUID island = newIsland(newUser());
        UUID user = newUser();
        long balanceBefore = islandBalance(island);
        pins.pin(user, island, "magazine", null);
        FocusSessionView started = focus.startSea(user, new SeaFocusSessionStartCommandRequest(island),
                UUID.randomUUID());
        backdate(started.id(), 40 * 60);

        FocusFinishView finished = finish(user, started.id(), started.version(), UUID.randomUUID());

        String won = onlyReward(finished);
        assertThat(finished.kind()).isEqualTo("sea");
        assertThat(finished.seaReward().newProductIds()).containsExactly(won);
        assertThat(owned(user)).containsExactly(won);
        assertThat(settledReward(started.id())).containsEntry("customization_reward_product_id", won);
        assertThat(finished.earnedFish()).isZero();
        assertThat(islandBalance(island)).isEqualTo(balanceBefore);
    }

    @Test
    @DisplayName("휴식 제외 899초는 아무것도 없다 — 정산 행의 두 칸도 비고 보유 행·사건이 없다")
    void under15MinutesGrantsNothing() {
        UUID user = newUser();
        FocusSessionView paused = pausedWithActiveSeconds(user, newIsland(user), 899);

        FocusFinishView finished = finish(user, paused.id(), paused.version(), UUID.randomUUID());

        assertThat(finished.activeSeconds()).isEqualTo(899);
        assertThat(finished.seaReward()).as("섬도 객체 — 받은 것 없음은 빈 목록이다").isNotNull();
        assertThat(finished.seaReward().grantedProductIds()).isEmpty();
        assertThat(finished.seaReward().newProductIds()).isEmpty();
        assertThat(settledReward(paused.id())).containsEntry("customization_reward_revision", null)
                .containsEntry("customization_reward_product_id", null)
                .containsEntry("customization_reward_new", null);
        assertThat(owned(user)).isEmpty();
        assertThat(inventoryEvents(user)).isZero();
    }

    @Test
    @DisplayName("휴식 제외 정확히 900초면 1개다")
    void exactly900SecondsGrantsOne() {
        UUID user = newUser();
        FocusSessionView paused = pausedWithActiveSeconds(user, newIsland(user), 900);

        FocusFinishView finished = finish(user, paused.id(), paused.version(), UUID.randomUUID());

        assertThat(finished.activeSeconds()).isEqualTo(900);
        assertThat(owned(user)).containsExactly(onlyReward(finished));
    }

    @Test
    @DisplayName("2시간 집중해도 정확히 1개다 — 누적 단계가 없다")
    void twoHoursStillGrantsExactlyOne() {
        UUID user = newUser();
        FocusSessionView started = start(user, newIsland(user));
        backdate(started.id(), 2 * 3600);

        FocusFinishView finished = finish(user, started.id(), started.version(), UUID.randomUUID());

        assertThat(finished.activeSeconds()).isGreaterThanOrEqualTo(7200);
        assertThat(owned(user)).containsExactly(onlyReward(finished));
        assertThat(inventoryEvents(user)).isEqualTo(1);
    }

    @Test
    @DisplayName("이미 가진 아이템이 또 뽑히면 결과는 그 아이템이지만 보유 행은 하나뿐이고 사건도 한 번이다")
    void duplicateWinKeepsSingleOwnedRow() {
        String only = seedSingleItemRevision("");
        UUID user = newUser();
        UUID island = newIsland(user);

        FocusSessionView first = start(user, island);
        backdate(first.id(), 20 * 60);
        FocusFinishView firstWin = finish(user, first.id(), first.version(), UUID.randomUUID());
        assertThat(onlyReward(firstWin)).isEqualTo(only);
        assertThat(firstWin.seaReward().newProductIds()).containsExactly(only);
        FocusSessionView second = start(user, island);
        backdate(second.id(), 20 * 60);
        FocusFinishView secondWin = finish(user, second.id(), second.version(), UUID.randomUUID());
        assertThat(onlyReward(secondWin)).as("중복 획득도 결과에 나온다").isEqualTo(only);
        assertThat(secondWin.seaReward().newProductIds()).as("이미 가진 상품 — NEW! 아님").isEmpty();

        assertThat(owned(user)).as("(user, product) 보유 행은 처음 한 번").containsExactly(only);
        assertThat(inventoryEvents(user)).isEqualTo(1);
        assertThat(settledReward(second.id())).containsEntry("customization_reward_product_id", only)
                .containsEntry("customization_reward_new", false);
    }

    @Test
    @DisplayName("같은 키 재시도와 새 키 finish 는 정산 행의 결과를 그대로 돌려준다 — 정책이 바뀌어도 다시 뽑지 않는다")
    void retryAndNewKeyReturnSameRewardWithoutRedraw() {
        UUID user = newUser();
        FocusSessionView started = start(user, newIsland(user));
        backdate(started.id(), 40 * 60);
        UUID key = UUID.randomUUID();
        FocusFinishView finished = finish(user, started.id(), started.version(), key);
        String won = onlyReward(finished);
        assertThat(finished.seaReward().newProductIds()).containsExactly(won);
        // 지금 정책을 «다른 아이템 한 줄» 로 바꾼다 — 다시 뽑으면 반드시 그 아이템이 나온다.
        // 새 키 finish 에서 «지금» 보유를 보면 이미 가졌으니 NEW! 가 사라질 것이다 — 정산 행의 처음 값이어야 한다.
        String other = seedSingleItemRevision(won);

        assertThat(finish(user, started.id(), started.version(), key)).isEqualTo(finished);
        FocusFinishView again = finish(user, started.id(), started.version(), UUID.randomUUID());

        assertThat(again.seaReward()).as("NEW! 까지 처음 값 그대로").isEqualTo(finished.seaReward());
        assertThat(onlyReward(again)).isNotEqualTo(other);
        assertThat(owned(user)).containsExactly(won);
        assertThat(inventoryEvents(user)).isEqualTo(1);
    }

    @Test
    @DisplayName("섬 휴식 1시간 자동 종료도 같은 정산으로 1개를 주고, pending-result 와 새 키 finish 가 같은 아이템을 보여 준다")
    void restAutoCloseGrantsSameAndPendingResultShowsIt() {
        UUID user = newUser();
        FocusSessionView paused = pausedWithActiveSeconds(user, newIsland(user), 2400);
        shiftSession(paused.id(), 2 * 3600);
        CustomizationRewardPolicy policy = policies.findTopByOrderByRevisionDesc().orElseThrow();
        String expected = CustomizationRewardDraw.pick(policy, items.findByRevision(policy.getRevision()),
                FocusSessionKind.ISLAND, 2400, paused.id()).orElseThrow().getProductId();

        assertThat(focus.autoCloseTimedOutRest(paused.id())).isTrue();

        FocusFinishView pending = focus.pendingResult(user);
        assertThat(pending.recordId()).isEqualTo(paused.id());
        assertThat(pending.activeSeconds()).isEqualTo(2400);
        assertThat(onlyReward(pending)).as("세션 id 로 고정된 추첨 그대로").isEqualTo(expected);
        assertThat(pending.seaReward().newProductIds()).as("처음 가짐 — 다음 접속의 결과창에도 NEW!")
                .containsExactly(expected);
        assertThat(owned(user)).containsExactly(expected);
        assertThat(finish(user, paused.id(), paused.version(), UUID.randomUUID()).seaReward())
                .isEqualTo(pending.seaReward());
    }

    @Test
    @DisplayName("정책 JSON 에 장소·등급 키가 빠져도 finish 는 200 이고 보상만 건너뛴다 — 섬(희귀 키 없음)·바다(SEA 없음) 모두")
    void brokenPolicyWeightsSkipOnlyTheReward() {
        appendRevisionFrom(2, "(location_weights - 'SEA') #- '{ISLAND,rare}'", "category_weights");
        try {
            UUID user = newUser();
            UUID island = newIsland(user);
            FocusSessionView started = start(user, island);
            backdate(started.id(), 40 * 60);
            FocusFinishView islandFinish = finish(user, started.id(), started.version(), UUID.randomUUID());

            assertThat(islandFinish.seaReward().grantedProductIds()).isEmpty();
            assertThat(islandFinish.seaReward().newProductIds()).isEmpty();
            assertThat(islandFinish.earnedFish()).as("정산 나머지는 그대로").isEqualTo(40);
            assertThat(settledReward(started.id())).containsEntry("customization_reward_product_id", null);
            assertThat(owned(user)).isEmpty();

            UUID sailor = newUser();
            pins.pin(sailor, island, "magazine", null);
            FocusSessionView voyage = focus.startSea(sailor, new SeaFocusSessionStartCommandRequest(island),
                    UUID.randomUUID());
            backdate(voyage.id(), 40 * 60);
            FocusFinishView seaFinish = finish(sailor, voyage.id(), voyage.version(), UUID.randomUUID());

            assertThat(seaFinish.seaReward().grantedProductIds()).isEmpty();
            assertThat(jdbc.queryForObject("select lifecycle from focus_session_details where session_id=?",
                    String.class, voyage.id())).isEqualTo("COMPLETED");
            assertThat(owned(sailor)).isEmpty();
        } finally {
            // 지금 정책을 다시 온전한 revision 2 사본으로 — 다른 테스트가 이 깨진 정책을 보지 않게 한다.
            appendRevisionFrom(2, "location_weights", "category_weights");
        }
    }

    @Test
    @DisplayName("정책 가중치가 소수·문자열이어도 finish 는 200 이고 보상만 건너뛴다 — 정책 읽기는 늘 성공한다")
    void nonIntegerPolicyWeightsSkipOnlyTheReward() {
        appendRevisionFrom(2, "jsonb_set(location_weights, '{ISLAND,common}', '1.5')",
                "jsonb_set(category_weights, '{head}', '\"x\"')");
        try {
            UUID user = newUser();
            UUID island = newIsland(user);
            FocusSessionView started = start(user, island);
            backdate(started.id(), 40 * 60);
            FocusFinishView islandFinish = finish(user, started.id(), started.version(), UUID.randomUUID());

            assertThat(islandFinish.seaReward().grantedProductIds()).as("섬 가중치 1.5 — 버림 없이 거절").isEmpty();
            assertThat(islandFinish.earnedFish()).isEqualTo(40);
            assertThat(owned(user)).isEmpty();

            UUID sailor = newUser();
            pins.pin(sailor, island, "magazine", null);
            FocusSessionView voyage = focus.startSea(sailor, new SeaFocusSessionStartCommandRequest(island),
                    UUID.randomUUID());
            backdate(voyage.id(), 40 * 60);
            FocusFinishView seaFinish = finish(sailor, voyage.id(), voyage.version(), UUID.randomUUID());

            assertThat(seaFinish.seaReward().grantedProductIds()).as("카테고리 가중치 \"x\"").isEmpty();
            assertThat(settledReward(voyage.id())).containsEntry("customization_reward_product_id", null);
            assertThat(owned(sailor)).isEmpty();
        } finally {
            appendRevisionFrom(2, "location_weights", "category_weights");
        }
    }

    @Test
    @DisplayName("다른 출처로 이미 가진 상품이 뽑히면 결과에는 나오지만 보유 행은 그대로 1개이고 사건도 없다")
    void preOwnedWinKeepsTheExistingRow() {
        String only = seedSingleItemRevision("");
        UUID user = newUser();
        jdbc.update("insert into owned_products (id, owner_type, user_id, product_id, granted_ref) "
                + "values (?, 'user', ?, ?, 'shop:test')", UUID.randomUUID(), user, only);
        FocusSessionView started = start(user, newIsland(user));
        backdate(started.id(), 20 * 60);

        FocusFinishView finished = finish(user, started.id(), started.version(), UUID.randomUUID());
        assertThat(onlyReward(finished)).isEqualTo(only);
        assertThat(finished.seaReward().newProductIds()).as("다른 출처로 이미 가짐 — NEW! 아님").isEmpty();

        assertThat(owned(user)).containsExactly(only);
        assertThat(jdbc.queryForObject("select granted_ref from owned_products where user_id=?", String.class, user))
                .as("먼저 있던 행을 덮지 않는다").isEqualTo("shop:test");
        assertThat(inventoryEvents(user)).isZero();
    }

    // ---------------------------------------------------------------- 도우미

    private static String onlyReward(FocusFinishView view) {
        assertThat(view.seaReward().grantedProductIds()).hasSize(1);
        return view.seaReward().grantedProductIds().get(0);
    }

    /**
     * 지금 정책을 복사해 후보 한 줄짜리 새 revision 을 심는다 — 그 한 줄은 등록된 머리·일반 중 {@code except} 가 아닌
     * 첫 아이템이다(빼지 않으려면 빈 문자열). 15분 이상이면 언제나 그 아이템이 뽑힌다. 앞선 테스트가 심은 한 줄짜리
     * revision 이 지금 정책이어도 고를 수 있게 revision 을 가리지 않고 고른다.
     */
    private String seedSingleItemRevision(String except) {
        int current = currentRevision();
        String productId = jdbc.queryForObject("select product_id from customization_reward_items "
                + "where category='head' and rarity='common' and product_id <> ? "
                + "order by sort_order, product_id limit 1", String.class, except);
        jdbc.update("insert into customization_reward_policies (revision, minimum_active_seconds, rare_unlock_seconds, "
                + "legendary_unlock_seconds, time_half_seconds, rare_max_bonus_ppm, legendary_max_bonus_ppm, "
                + "rewards_per_eligible_session, duplicates_allowed, location_weights, category_weights, "
                + "source_workbook_sha256) select ?, minimum_active_seconds, rare_unlock_seconds, "
                + "legendary_unlock_seconds, time_half_seconds, rare_max_bonus_ppm, legendary_max_bonus_ppm, "
                + "rewards_per_eligible_session, duplicates_allowed, location_weights, '{\"head\": 1}'::jsonb, "
                + "source_workbook_sha256 from customization_reward_policies where revision=?", current + 1, current);
        jdbc.update("insert into customization_reward_items (revision, product_id, source_asset_id, category, rarity, "
                + "rarity_reason, render_data, sort_order) select ?, product_id, source_asset_id, category, rarity, "
                + "rarity_reason, render_data, sort_order from customization_reward_items "
                + "where product_id=? order by revision limit 1", current + 1, productId);
        return productId;
    }

    /**
     * {@code source} revision 의 정책·후보 전체를 새 revision(지금 최대 + 1)으로 복사한다. 장소·카테고리 가중치는
     * 주어진 SQL 식으로 바꿔 넣는다 — 그대로 두려면 {@code location_weights}·{@code category_weights}. 지금 정책이
     * 깨져 있어도 돌도록 최대 revision 은 엔티티가 아니라 SQL 로 읽는다.
     */
    private void appendRevisionFrom(int source, String locationWeightsSql, String categoryWeightsSql) {
        int next = currentRevision() + 1;
        jdbc.update("insert into customization_reward_policies (revision, minimum_active_seconds, rare_unlock_seconds, "
                + "legendary_unlock_seconds, time_half_seconds, rare_max_bonus_ppm, legendary_max_bonus_ppm, "
                + "rewards_per_eligible_session, duplicates_allowed, location_weights, category_weights, "
                + "source_workbook_sha256) select ?, minimum_active_seconds, rare_unlock_seconds, "
                + "legendary_unlock_seconds, time_half_seconds, rare_max_bonus_ppm, legendary_max_bonus_ppm, "
                + "rewards_per_eligible_session, duplicates_allowed, " + locationWeightsSql + ", " + categoryWeightsSql
                + ", "
                + "source_workbook_sha256 from customization_reward_policies where revision=?", next, source);
        jdbc.update("insert into customization_reward_items (revision, product_id, source_asset_id, category, rarity, "
                + "rarity_reason, render_data, sort_order) select ?, product_id, source_asset_id, category, rarity, "
                + "rarity_reason, render_data, sort_order from customization_reward_items where revision=?",
                next, source);
    }

    private int currentRevision() {
        return jdbc.queryForObject("select max(revision) from customization_reward_policies", Integer.class);
    }

    /** 섬 세션을 시작해 휴식으로 ACTIVE 구간을 닫고, 그 길이를 정확히 {@code seconds} 로 맞춘다. */
    private FocusSessionView pausedWithActiveSeconds(UUID user, UUID island, long seconds) {
        FocusSessionView started = start(user, island);
        FocusSessionView paused = focus.pause(user, started.id(), new FocusVersionedCommandRequest(started.version()),
                UUID.randomUUID());
        jdbc.update("update focus_session_intervals set started_at = ended_at - make_interval(secs => ?) "
                + "where session_id=? and kind='ACTIVE'", seconds, started.id());
        return paused;
    }

    /** 세션의 모든 시각을 {@code seconds} 만큼 과거로 옮긴다 — 휴식이 오래된 것으로 만든다. */
    private void shiftSession(UUID sessionId, long seconds) {
        String shift = "make_interval(secs => " + seconds + ")";
        jdbc.update("update focus_sessions set started_at = started_at - " + shift + " where id=?", sessionId);
        jdbc.update("update focus_session_details set last_transition_at = last_transition_at - " + shift
                + " where session_id=?", sessionId);
        jdbc.update("update focus_session_intervals set started_at = started_at - " + shift
                + ", ended_at = ended_at - " + shift + " where session_id=?", sessionId);
    }

    /** 방금 시작한 세션을 {@code seconds} 전에 시작한 것으로 옮긴다 — 실제 시계를 기다리지 않고 정산 값을 본다. */
    private void backdate(UUID sessionId, long seconds) {
        Timestamp at = Timestamp.from(Instant.now().minusSeconds(seconds));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, sessionId);
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, sessionId);
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at,
                sessionId);
    }

    private FocusFinishView finish(UUID user, UUID sessionId, long version, UUID key) {
        return focus.finish(user, sessionId, new FocusVersionedCommandRequest(version), key);
    }

    private FocusSessionView start(UUID user, UUID island) {
        return focus.start(user, new FocusSessionStartCommandRequest(island, "알고리즘", 25), UUID.randomUUID());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private UUID newIsland(UUID owner) {
        return islands.create(owner, new CreateIslandCommandRequest("보상섬", null, false, null), UUID.randomUUID())
                .id();
    }

    private Map<String, Object> settledReward(UUID sessionId) {
        return jdbc.queryForMap("select customization_reward_revision, customization_reward_product_id, "
                + "customization_reward_new from focus_settlements where session_id=?", sessionId);
    }

    private String rewardCategory(UUID sessionId) {
        return jdbc.queryForObject("select i.category from focus_settlements s join customization_reward_items i "
                + "on i.revision = s.customization_reward_revision "
                + "and i.product_id = s.customization_reward_product_id where s.session_id=?", String.class, sessionId);
    }

    private List<String> owned(UUID user) {
        return jdbc.queryForList("select product_id from owned_products where user_id=?", String.class, user);
    }

    private long inventoryEvents(UUID user) {
        return jdbc.queryForObject("select count(*) from event_outbox where type='inventory.updated' "
                + "and aggregate_type='USER_INVENTORY' and aggregate_id=?", Long.class, user.toString());
    }

    private long islandBalance(UUID islandId) {
        return jdbc.queryForObject("select coalesce(sum(balance),0) from island_wallets where island_id=?",
                Long.class, islandId);
    }
}
