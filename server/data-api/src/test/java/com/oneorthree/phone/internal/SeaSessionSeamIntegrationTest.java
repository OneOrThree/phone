package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusFinishView;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusRewardAccrualService;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.GoldenFishService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.TelescopePinService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 바다 집중 seam (GROMO-2274, 결정 N3) — 집중 종료의 정산이 세션 종류({@code kind})를 따라 갈리는지
 * <b>실제 Flyway PostgreSQL</b> 위에서 본다.
 *
 * <p>GROMO-2299 부터 판정은 {@code focus_session_details.kind} 이고, 이 클래스는 스파이 없이 <b>실제 바다 세션</b>
 * ({@code startSea}, 목적지는 핀으로 망원경에 넣은 섬)으로 같은 단언을 건다. 섬 세션을 같은 시나리오로 돌린 쪽은
 * «섬 통장 적립 그대로» 를 고정한다. 꾸미기 보상(GROMO-2301)은 두 종류 모두 같은 경로로 1개다.
 *
 * <p>분당 적립 크론({@code focus.reward.accrual-enabled})은 기본값(꺼짐)으로 둔다 — 지급 경로를 finish 의
 * 마지막 확정 하나로 좁혀, 통장 잔액 단언이 크론 시각에 흔들리지 않게 한다. 크론·황금 물고기 스케줄러가 부르는
 * {@code FocusRewardAccrualService.accrue}·{@code GoldenFishService.drawAndCredit} 는 테스트가 직접 부른다(스케줄러는
 * 그 한 줄만 부른다) — 판정을 쓰는 «공유 지점» 이 그 둘이다.
 */
@SpringBootTest
class SeaSessionSeamIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
    }

    @Autowired
    TelescopePinService pins;
    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    FocusRewardAccrualService rewardAccruals;
    @Autowired
    GoldenFishService goldenFish;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserQueryService users;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("바다 판정이면 섬 통장은 잔액도 원장도 그대로이고, 꾸미기 보상 1개가 지급돼 seaReward 가 채워진다")
    void seaSessionSettlesTheRewardAndLeavesTheIslandWalletAlone() {
        UUID island = newIsland(newUser(), "바다판정섬");
        UUID user = newUser();
        long balanceBefore = islandBalance(island);
        long ledgerBefore = ledgerRows(island);

        FocusSessionView started = startSea(user, island);
        backdate(started.id(), 40 * 60);
        UUID key = UUID.randomUUID();
        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), key);

        assertThat(finished.seaReward().grantedProductIds()).as("15분 이상 → 정확히 1개").hasSize(1);
        assertThat(finished.seaReward().minutesToNextTier()).as("단계표가 없다").isNull();
        String won = finished.seaReward().grantedProductIds().get(0);
        assertThat(finished.activeSeconds()).isBetween(2400L, 2460L);

        assertThat(islandBalance(island)).as("village_points 잔액 불변").isEqualTo(balanceBefore);
        assertThat(ledgerRows(island)).as("원장 불변").isEqualTo(ledgerBefore);
        assertThat(count("select count(*) from focus_reward_accruals where session_id=?", started.id()))
                .as("적립 행도 없다").isZero();
        assertThat(finished.earnedFish()).isZero();
        assertThat(finished.allocation().personalFishAdded()).isZero();
        assertThat(finished.allocation().constructionFishAdded()).isZero();

        assertThat(jdbc.queryForList("select product_id from owned_products where user_id=?", String.class, user))
                .containsExactly(won);
        // 일 집계·정산 행·세션 종결은 섬 세션과 같게 간다 — 통장만 건드리지 않는다.
        assertThat(count("select coalesce(sum(total_focus_seconds),0) from daily_focus_stats where user_id=?", user))
                .isEqualTo(finished.activeSeconds());
        assertThat(jdbc.queryForObject("select lifecycle from focus_session_details where session_id=?",
                String.class, started.id())).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject("select customization_reward_product_id from focus_settlements "
                + "where session_id=? and earned_fish=0", String.class, started.id())).isEqualTo(won);

        // 같은 키의 재시도는 receipt 가 원 응답을 그대로 돌려준다. 새 키로 다시 끝내도 정산 행에 남긴 결과라 같은
        // seaReward 이고, 다시 뽑거나 지급하지 않는다.
        FocusFinishView replayed = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), key);
        assertThat(replayed).isEqualTo(finished);
        FocusFinishView again = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        assertThat(again.seaReward()).isEqualTo(finished.seaReward());
        assertThat(again.activeSeconds()).isEqualTo(finished.activeSeconds());
        assertThat(jdbc.queryForList("select product_id from owned_products where user_id=?", String.class, user))
                .containsExactly(won);
    }

    @Test
    @DisplayName("섬 세션은 섬 통장 적립이 종전 그대로이고, 꾸미기 보상도 같은 경로로 1개 받는다")
    void islandSessionKeepsTheExistingAccrualAndAlsoGetsTheReward() {
        UUID user = newUser();
        UUID island = newIsland(user, "섬세션섬");

        FocusSessionView started = start(user, island);
        backdate(started.id(), 40 * 60);
        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        assertThat(finished.seaReward().grantedProductIds()).as("섬도 15분 이상이면 1개").hasSize(1);
        assertThat(finished.earnedFish()).as("40분 → 40마리").isEqualTo(40);
        assertThat(finished.allocation().constructionFishAdded()).isEqualTo(40);
        assertThat(islandBalance(island)).as("섬 통장 적립 그대로").isEqualTo(40);
        assertThat(count("select coalesce(sum(earned_fish),0) from focus_reward_accruals where session_id=?",
                started.id())).isEqualTo(40);
        assertThat(jdbc.queryForList("select product_id from owned_products where user_id=?", String.class, user))
                .containsExactlyElementsOf(finished.seaReward().grantedProductIds());
    }

    @Test
    @DisplayName("바다 판정이면 매분 적립 틱도 섬 통장에 넣지 않는다 — 워터마크를 밀지 않고, 종료가 읽는 적립 합도 0 이다")
    void minuteTickLeavesSeaSessionsAlone() {
        UUID island = newIsland(newUser(), "틱판정섬");
        UUID user = newUser();
        long balanceBefore = islandBalance(island);
        long ledgerBefore = ledgerRows(island);
        FocusSessionView started = startSea(user, island);
        backdate(started.id(), 40 * 60);

        assertThat(rewardAccruals.accrue(started.id())).as("틱이 와도 바다 세션은 0마리").isZero();

        assertThat(islandBalance(island)).isEqualTo(balanceBefore);
        assertThat(ledgerRows(island)).isEqualTo(ledgerBefore);
        assertThat(count("select count(*) from focus_reward_accruals where session_id=?", started.id())).isZero();
        assertThat(count("select rewarded_seconds from focus_session_details where session_id=?", started.id()))
                .as("워터마크를 밀지 않는다").isZero();

        // 종료가 «이미 틱이 넣은 적립 합» 으로 읽는 값도 0 이다 — 바다 세션은 통장에 한 마리도 들어가지 않았다.
        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        assertThat(finished.seaReward()).isNotNull();
        assertThat(finished.earnedFish()).isZero();
        assertThat(finished.allocation().constructionFishAdded()).isZero();
        assertThat(islandBalance(island)).isEqualTo(balanceBefore);
        assertThat(ledgerRows(island)).isEqualTo(ledgerBefore);

        // 대조: 판정이 false 인 같은 길이의 섬 세션은 같은 틱이 40마리를 넣는다 — 위 0 은 가드 덕이다.
        UUID controlUser = newUser();
        UUID controlIsland = newIsland(controlUser, "틱대조섬");
        FocusSessionView control = start(controlUser, controlIsland);
        backdate(control.id(), 40 * 60);
        assertThat(rewardAccruals.accrue(control.id())).isEqualTo(40);
        assertThat(islandBalance(controlIsland)).isEqualTo(40);
    }

    @Test
    @DisplayName("황금 물고기 추첨은 바다 세션을 참여자로 세지 않는다 — 섬 세션 하나에 바다 세션 둘(목적지가 같은 섬)이면 확률 100% 여도 나타나지 않는다")
    void goldenFishDrawSkipsSeaSessions() {
        UUID owner = newUser();
        UUID island = newIsland(owner, "황금판정섬");
        UUID guest = newUser();
        joinAndMoveTo(guest, island);
        FocusSessionView ownerSession = start(owner, island);
        FocusSessionView seaOne = startSea(newUser(), island);
        FocusSessionView seaTwo = startSea(newUser(), island);
        alwaysWin();
        Instant minute = Instant.now().truncatedTo(ChronoUnit.MINUTES);
        long balanceBefore = islandBalance(island);
        long ledgerBefore = ledgerRows(island);

        // 이 섬을 향한 ACTIVE 세션은 셋이지만 섬 세션은 하나뿐이다 — 바다 둘은 참여자가 아니라 추첨이 열리지 않는다.
        assertThat(goldenFish.drawAndCredit(island, minute)).isFalse();

        assertThat(islandBalance(island)).isEqualTo(balanceBefore);
        assertThat(ledgerRows(island)).isEqualTo(ledgerBefore);
        assertThat(count("select coalesce(sum(golden_fish),0) from focus_reward_accruals "
                + "where session_id in (?, ?, ?)", ownerSession.id(), seaOne.id(), seaTwo.id())).isZero();

        // 대조: 섬 세션이 둘이 되면 같은 분의 같은 추첨이 당첨된다 — 위 false 는 바다 세션을 세지 않은 덕이다.
        start(guest, island);
        assertThat(goldenFish.drawAndCredit(island, minute)).isTrue();
        assertThat(islandBalance(island)).isEqualTo(balanceBefore + 50);
    }

    // ---------------------------------------------------------------- 도우미

    /** 확률표를 100%로 올린 새 revision — 현재 정책은 가장 큰 revision 이고 세션은 시작할 때 자기 revision 을 고정한다. */
    private void alwaysWin() {
        jdbc.update("INSERT INTO focus_reward_policies (revision, seconds_per_fish, daily_cap_fish, "
                + "personal_share_percent, golden_fish_reward, golden_max_members, golden_chance_ppm) "
                + "SELECT COALESCE(MAX(revision), 0) + 1, 60, 480, 0, 50, 5, '1000000,1000000,1000000,1000000' "
                + "FROM focus_reward_policies");
    }

    /** 이미 있는 섬에 주민으로 넣고 도착해 현재 섬을 옮긴다 — 가입 승인 흐름은 이 테스트의 관심이 아니다. */
    private void joinAndMoveTo(UUID userId, UUID islandId) {
        members.save(GroupMember.builder().user(users.getCaller(userId)).group(groups.findById(islandId).orElseThrow())
                .role(GroupMemberRole.MEMBER).build());
        islands.arrive(userId, islandId, UUID.randomUUID());
    }

    /** 목적지 섬을 핀으로 망원경에 넣고(소속 0 계정도 된다) 그 항목의 항해 분으로 바다 세션을 시작한다. */
    private FocusSessionView startSea(UUID user, UUID island) {
        pins.pin(user, island, "magazine", null);
        return focus.startSea(user, new SeaFocusSessionStartCommandRequest(island), UUID.randomUUID());
    }

    private FocusSessionView start(UUID user, UUID island) {
        return focus.start(user, new FocusSessionStartCommandRequest(island, "알고리즘", 25), UUID.randomUUID());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private UUID newIsland(UUID owner, String name) {
        return islands.create(owner, new CreateIslandCommandRequest(name, null, false, null), UUID.randomUUID()).id();
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
