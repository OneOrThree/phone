package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusFishEarningsRepository;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusRewardPolicyRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/** 운영 Flyway 스키마 위에서 최초 5초·중복·동시 지급·종료 결과까지 검증한다. */
@SpringBootTest
class FocusTutorialRewardIntegrationTest {
    private static final Instant START = Instant.parse("2031-03-10T10:00:00Z");
    private final AtomicReference<Instant> now = new AtomicReference<>(START);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @MockitoBean Clock clock;
    @Autowired FocusTutorialRewardService rewards;
    @Autowired FocusRewardAccrualService regularRewards;
    @Autowired FocusSessionLifecycleService lifecycle;
    @Autowired UserRepository users;
    @Autowired GroupRepository groups;
    @Autowired GroupMemberRepository members;
    @Autowired FocusSessionRepository sessions;
    @Autowired FocusSessionDetailRepository details;
    @Autowired FocusSessionIntervalRepository intervals;
    @Autowired FocusRewardPolicyRepository policies;
    @Autowired FocusRewardAccrualRepository accruals;
    @Autowired FocusFishEarningsRepository earnings;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void clock() {
        now.set(START);
        when(clock.instant()).thenAnswer(invocation -> now.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
    }

    @Test
    void fiveSecondsCreditsOnceAndFinishIncludesItWithoutPayingAgain() {
        var fixture = fixture();
        now.set(START.plusSeconds(4));
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("pending");
        assertThat(balance(fixture.island())).isZero();
        now.set(START.plusSeconds(5));
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("granted");
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("granted");
        assertThat(balance(fixture.island())).isEqualTo(1);
        assertThat(accruals.sumEarnedFishOnDay(fixture.user(), fixture.island(), LocalDate.of(2031, 3, 10)))
                .as("일반 480마리 상한을 사용하지 않는다").isZero();
        assertThat(earnings.sumEarnedFishByUser(fixture.island(), List.of(fixture.user())).get(0).getEarnedFish())
                .isEqualTo(1);
        var result = lifecycle.finish(fixture.user(), fixture.session(),
                new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        assertThat(result.earnedFish()).isEqualTo(1);
        assertThat(result.activeSeconds()).isEqualTo(5);
        assertThat(balance(fixture.island())).isEqualTo(1);
    }

    @Test
    void experienceCreditsOnceWithoutCreatingFocusDataAndIncludesEarnings() {
        var fixture = experienceFixture();
        assertThat(rewards.claimExperience(fixture.user(), fixture.island()).status()).isEqualTo("granted");
        assertThat(rewards.claimExperience(fixture.user(), fixture.island()).status()).isEqualTo("granted");
        assertThat(balance(fixture.island())).isEqualTo(1);
        assertThat(earnings.sumEarnedFishByUser(fixture.island(), List.of(fixture.user())).get(0).getEarnedFish())
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_sessions WHERE user_id = ?",
                Integer.class, fixture.user())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_session_details WHERE user_id = ?",
                Integer.class, fixture.user())).isZero();
        assertThat(accruals.sumEarnedFishOnDay(fixture.user(), fixture.island(), LocalDate.of(2031, 3, 10)))
                .isZero();
    }

    @Test
    void experienceAndLegacyRequestsShareOneReceiptEvenWhenConcurrent() {
        var fixture = fixture();
        now.set(START.plusSeconds(5));
        var first = CompletableFuture.supplyAsync(() -> rewards.claimExperience(fixture.user(), fixture.island()));
        var second = CompletableFuture.supplyAsync(() -> rewards.claim(fixture.user(), fixture.session()));
        assertThat(List.of(first.join().status(), second.join().status()))
                .containsExactlyInAnyOrder("granted", "unavailable");
        assertThat(balance(fixture.island())).isEqualTo(1);
        assertThat(earnings.sumEarnedFishByUser(fixture.island(), List.of(fixture.user())).get(0).getEarnedFish())
                .isEqualTo(1);
    }

    @Test
    void legacyReceiptCannotClaimExperienceAndExperienceCannotClaimLegacy() {
        var old = fixture();
        now.set(START.plusSeconds(5));
        rewards.claim(old.user(), old.session());
        assertThat(rewards.claimExperience(old.user(), old.island()).status()).isEqualTo("unavailable");
        var fresh = fixture();
        rewards.claimExperience(fresh.user(), fresh.island());
        assertThat(rewards.claim(fresh.user(), fresh.session()).status()).isEqualTo("unavailable");
        assertThat(balance(old.island())).isEqualTo(1);
        assertThat(balance(fresh.island())).isEqualTo(1);
    }

    @Test
    void experienceRequiresMembershipAndCannotMoveRewardToAnotherIsland() {
        var fixture = experienceFixture();
        var other = groups.save(Group.builder().name("다른 섬").maxMembers(15).build());
        assertFailure(() -> rewards.claimExperience(fixture.user(), other.getId()),
                FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
        rewards.claimExperience(fixture.user(), fixture.island());
        members.save(GroupMember.builder().user(users.findById(fixture.user()).orElseThrow())
                .group(other).role(GroupMemberRole.OWNER).build());
        assertThat(rewards.claimExperience(fixture.user(), other.getId()).status()).isEqualTo("unavailable");
        assertThat(balance(other.getId())).isZero();
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ?", fixture.user());
        assertFailure(() -> rewards.claimExperience(fixture.user(), fixture.island()),
                FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
    }

    @Test
    void experienceFailureRollsBackAndConcurrentRetryCreditsOnlyOnce() {
        var fixture = experienceFixture();
        jdbc.update("INSERT INTO island_wallets (island_id, balance) VALUES (?, ?)",
                fixture.island(), Integer.MAX_VALUE);
        assertThatThrownBy(() -> rewards.claimExperience(fixture.user(), fixture.island()))
                .isInstanceOf(RuntimeException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_tutorial_rewards WHERE user_id = ?",
                Integer.class, fixture.user())).isZero();
        jdbc.update("UPDATE island_wallets SET balance = 0 WHERE island_id = ?", fixture.island());
        var first = CompletableFuture.supplyAsync(() -> rewards.claimExperience(fixture.user(), fixture.island()));
        var second = CompletableFuture.supplyAsync(() -> rewards.claimExperience(fixture.user(), fixture.island()));
        assertThat(first.join().status()).isEqualTo("granted");
        assertThat(second.join().status()).isEqualTo("granted");
        assertThat(balance(fixture.island())).isEqualTo(1);
    }

    @Test
    void deletingIslandKeepsAccountReceiptAndBlocksRewardOnNewIsland() {
        var fixture = experienceFixture();
        rewards.claimExperience(fixture.user(), fixture.island());
        jdbc.update("DELETE FROM group_members WHERE group_id = ?", fixture.island());
        // 실제 섬은 soft-delete한다. 향후 정리 작업의 물리 삭제에서도 영수증 FK가 보존되는지 검증한다.
        jdbc.update("DELETE FROM island_wallet_transactions WHERE island_id = ?", fixture.island());
        jdbc.update("DELETE FROM island_wallets WHERE island_id = ?", fixture.island());
        jdbc.update("DELETE FROM island_construction_states WHERE island_id = ?", fixture.island());
        jdbc.update("DELETE FROM groups WHERE id = ?", fixture.island());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_tutorial_rewards "
                + "WHERE user_id = ? AND island_id IS NULL AND session_id IS NULL",
                Integer.class, fixture.user())).isEqualTo(1);
        var next = groups.save(Group.builder().name("다시 가입한 섬").maxMembers(15).build());
        members.save(GroupMember.builder().user(users.findById(fixture.user()).orElseThrow())
                .group(next).role(GroupMemberRole.OWNER).build());
        assertThat(rewards.claimExperience(fixture.user(), next.getId()).status()).isEqualTo("unavailable");
        assertThat(balance(next.getId())).isZero();
    }

    private Fixture experienceFixture() {
        User user = users.save(User.builder().nickname("체험-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("체험 섬").maxMembers(15).build());
        members.save(GroupMember.builder().user(user).group(island).role(GroupMemberRole.OWNER).build());
        return new Fixture(user.getId(), island.getId(), null);
    }

    @Test
    void concurrentRequestsCreateOneReceiptAndOneFish() {
        var fixture = fixture();
        now.set(START.plusSeconds(5));
        var first = CompletableFuture.supplyAsync(() -> rewards.claim(fixture.user(), fixture.session()));
        var second = CompletableFuture.supplyAsync(() -> rewards.claim(fixture.user(), fixture.session()));
        assertThat(first.join().status()).isEqualTo("granted");
        assertThat(second.join().status()).isEqualTo("granted");
        assertThat(balance(fixture.island())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_tutorial_rewards WHERE user_id = ?",
                Integer.class, fixture.user())).isEqualTo(1);
    }

    @Test
    void regularMinuteRemainsAnAdditionalFish() {
        var fixture = fixture();
        now.set(START.plusSeconds(5));
        rewards.claim(fixture.user(), fixture.session());
        now.set(START.plusSeconds(60));
        assertThat(regularRewards.accrue(fixture.session())).isEqualTo(1);
        assertThat(regularRewards.accrue(fixture.session())).isZero();
        assertThat(balance(fixture.island())).isEqualTo(2);
        assertThat(accruals.sumEarnedFishOfSession(fixture.session())).isEqualTo(2);
    }

    @Test
    void failedWalletCreditRollsBackReceiptAndCanBeRetried() {
        var fixture = fixture();
        now.set(START.plusSeconds(5));
        jdbc.update("INSERT INTO island_wallets (island_id, balance) VALUES (?, ?)",
                fixture.island(), Integer.MAX_VALUE);
        assertThatThrownBy(() -> rewards.claim(fixture.user(), fixture.session()))
                .isInstanceOf(RuntimeException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_tutorial_rewards WHERE user_id = ?",
                Integer.class, fixture.user())).isZero();
        assertThat(accruals.sumEarnedFishOfSession(fixture.session())).isZero();
        jdbc.update("UPDATE island_wallets SET balance = 0 WHERE island_id = ?", fixture.island());
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("granted");
        assertThat(balance(fixture.island())).isEqualTo(1);
    }

    @Test
    void anotherSessionEvenOnAnotherIslandCannotClaimAgain() {
        var fixture = fixture();
        now.set(START.plusSeconds(5));
        rewards.claim(fixture.user(), fixture.session());
        lifecycle.finish(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        var otherIsland = groups.save(Group.builder().name("다른 섬").maxMembers(15).build());
        var user = users.findById(fixture.user()).orElseThrow();
        members.save(GroupMember.builder().user(user).group(otherIsland).role(GroupMemberRole.OWNER).build());
        UUID next = session(user, otherIsland);
        assertThat(rewards.claim(user.getId(), next).status()).isEqualTo("unavailable");
        assertThat(balance(otherIsland.getId())).isZero();
    }

    @Test
    void anotherUserAndLostMembershipCannotClaim() {
        var fixture = fixture();
        var stranger = users.save(User.builder().nickname("타인-" + UUID.randomUUID()).build());
        now.set(START.plusSeconds(5));
        assertFailure(() -> rewards.claim(stranger.getId(), fixture.session()), FocusErrorCode.FORBIDDEN);
        assertFailure(() -> rewards.claim(fixture.user(), UUID.randomUUID()), FocusErrorCode.SESSION_NOT_FOUND);
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ?", fixture.user());
        assertFailure(() -> rewards.claim(fixture.user(), fixture.session()),
                FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
        assertThat(balance(fixture.island())).isZero();
    }

    @Test
    void membershipEpochMismatchCannotClaim() {
        var fixture = fixture();
        now.set(START.plusSeconds(5));
        jdbc.update("UPDATE focus_session_details SET membership_epoch_at_start = membership_epoch_at_start + 1 "
                + "WHERE session_id = ?", fixture.session());
        assertFailure(() -> rewards.claim(fixture.user(), fixture.session()),
                FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
        assertThat(balance(fixture.island())).isZero();
    }

    @Test
    void endedSessionWithoutReceiptCannotClaim() {
        var fixture = fixture();
        now.set(START.plusSeconds(10));
        lifecycle.finish(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        assertFailure(() -> rewards.claim(fixture.user(), fixture.session()),
                FocusErrorCode.SESSION_STATE_CONFLICT);
        assertThat(balance(fixture.island())).isZero();
    }

    @Test
    void pausedSessionWithFiveActiveSecondsCanStillClaimAndFinishIncludesIt() {
        var fixture = fixture();
        now.set(START.plusSeconds(6));
        lifecycle.pause(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        now.set(START.plusSeconds(30));
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("granted");
        assertThat(balance(fixture.island())).isEqualTo(1);
        lifecycle.resume(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(2L), UUID.randomUUID());
        var result = lifecycle.finish(fixture.user(), fixture.session(),
                new FocusVersionedCommandRequest(3L), UUID.randomUUID());
        assertThat(result.earnedFish()).isEqualTo(1);
        assertThat(balance(fixture.island())).isEqualTo(1);
    }

    @Test
    void fishCheckConstraintAcceptsTutorialOnlyAndRejectsInvalidRows() {
        var fixture = fixture();
        now.set(START.plusSeconds(5));
        rewards.claim(fixture.user(), fixture.session());
        String row = "UPDATE focus_reward_accruals SET %s WHERE session_id = ?";
        assertThatThrownBy(() -> jdbc.update(row.formatted("tutorial_fish = 2"), fixture.session()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(row.formatted("tutorial_fish = 0"), fixture.session()))
                .as("세 적립 열의 합이 0이면 거부한다").isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.update(row.formatted("golden_fish = 1, tutorial_fish = 0"), fixture.session()))
                .as("황금만 받은 행은 허용한다").isEqualTo(1);
    }

    @Test
    void restDoesNotCountTowardFiveSeconds() {
        var fixture = fixture();
        now.set(START.plusSeconds(4));
        lifecycle.pause(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        now.set(START.plusSeconds(100));
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("pending");
        lifecycle.resume(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(2L), UUID.randomUUID());
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("pending");
        now.set(START.plusSeconds(101));
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("granted");
    }

    private static void assertFailure(org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
            FocusErrorCode expected) {
        assertThatThrownBy(call).isInstanceOfSatisfying(FocusException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(expected));
    }

    private Fixture fixture() {
        User user = users.save(User.builder().nickname("낚시-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("첫 섬").maxMembers(15).build());
        members.save(GroupMember.builder().user(user).group(island).role(GroupMemberRole.OWNER).build());
        return new Fixture(user.getId(), island.getId(), session(user, island));
    }

    private UUID session(User user, Group island) {
        UUID id = sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(START).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(id).userId(user.getId()).islandId(island.getId())
                .membershipEpochAtStart(1L).subject("첫 집중").lifecycle(FocusSessionLifecycle.ACTIVE)
                .policyRevision(policies.findFirstByOrderByRevisionDesc().orElseThrow().getRevision())
                .lastTransitionAt(START).build());
        intervals.save(FocusSessionInterval.builder().sessionId(id).ordinal(0)
                .kind(FocusIntervalKind.ACTIVE).startedAt(START).build());
        return id;
    }

    private int balance(UUID islandId) {
        return jdbc.query("SELECT balance FROM island_wallets WHERE island_id = ?",
                rs -> rs.next() ? rs.getInt(1) : 0, islandId);
    }

    private record Fixture(UUID user, UUID island, UUID session) {
    }
}
