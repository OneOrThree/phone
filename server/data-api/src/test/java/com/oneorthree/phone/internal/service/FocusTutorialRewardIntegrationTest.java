package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
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
        assertThatThrownBy(() -> rewards.claim(stranger.getId(), fixture.session()))
                .isInstanceOf(FocusException.class);
        jdbc.update("UPDATE group_members SET is_left = true WHERE user_id = ?", fixture.user());
        assertThatThrownBy(() -> rewards.claim(fixture.user(), fixture.session()))
                .isInstanceOf(FocusException.class);
        assertThat(balance(fixture.island())).isZero();
    }

    @Test
    void restDoesNotCountTowardFiveSeconds() {
        var fixture = fixture();
        now.set(START.plusSeconds(4));
        lifecycle.pause(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        now.set(START.plusSeconds(100));
        assertThatThrownBy(() -> rewards.claim(fixture.user(), fixture.session()))
                .isInstanceOf(FocusException.class);
        lifecycle.resume(fixture.user(), fixture.session(), new FocusVersionedCommandRequest(2L), UUID.randomUUID());
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("pending");
        now.set(START.plusSeconds(101));
        assertThat(rewards.claim(fixture.user(), fixture.session()).status()).isEqualTo("granted");
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
