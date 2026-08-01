package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 내기 취소·그룹 탈퇴 연동 통합 테스트 — 환불이 <b>정확히 한 번</b>, 그리고 정산 배치와 겹쳐도
 * 돈이 한 경로로만 움직이는지를 실 DB 로 고정한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@link GroupBetSettlementIntegrationTest} 와 같다
 * — 레이스 시나리오는 커밋(별도 스레드의 별도 트랜잭션)을 전제한다. 테스트 데이터는
 * {@code @AfterEach} 에서 직접 지운다.
 */
class GroupBetCancelWithdrawIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetService groupBetService;
    @Autowired
    GroupMemberService groupMemberService;
    @Autowired
    GroupBetSettler groupBetSettler;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;

    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 30;
    /** 판돈 차감 후 잔액. 참가 시점에 이미 STAKE 만큼 빠져 있는 상태를 재현한다. */
    private static final int BALANCE_AFTER_STAKE = 70;

    private Group group;
    private GroupChallenge challenge;
    /** 방장 — 탈퇴 시나리오에서 그룹을 지키는 별도 인물(내기에는 참가하지 않는다). */
    private User owner;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> bets = new ArrayList<>();
    private final List<DailyFocusStat> stats = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(challenge).durationMinutes(GOAL_MINUTES).build());
        owner = memberUser("방장", GroupMemberRole.OWNER);
    }

    @AfterEach
    void tearDown() {
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        bets.forEach(b -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(b.getId()))));
        groupChallengeBetRepository.deleteAll(bets);
        dailyFocusStatRepository.deleteAll(stats);
        groupChallengeDurationRepository.findById(challenge.getId())
                .ifPresent(groupChallengeDurationRepository::delete);
        groupChallengeRepository.delete(challenge);
        groupMemberRepository.deleteAll(groupMemberRepository.findByGroup(group));
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        bets.clear();
        stats.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    /** 그룹 멤버십까지 갖춘, 판돈을 이미 낸(잔액 70) 유저. */
    private User memberUser(String nickname, GroupMemberRole role) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        groupMemberRepository.save(GroupMember.builder().user(user).group(group).role(role).build());
        users.add(user);
        return user;
    }

    private GroupChallengeBet openBet(User creator, LocalDate betDate) {
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(challenge)
                .creatorUser(creator)
                .stake(STAKE)
                .betDate(betDate)
                .status(GroupBetStatus.OPEN)
                .build());
        bets.add(bet);
        return bet;
    }

    private void participant(GroupChallengeBet bet, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
    }

    private void focusStat(User user, LocalDate date, int minutes) {
        stats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(date).totalFocusSeconds(minutes * 60).build()));
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private long countOf(User user, CurrencyTransactionType type) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == type)
                .count();
    }

    private GroupBetStatus statusOf(GroupChallengeBet bet) {
        return groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getStatus();
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBet bet) {
        return groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId()));
    }

    // ── 취소 ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("취소 성공 — CANCELED 전이 + 판돈 환불이 지갑·원장에 정확히 한 번 반영된다")
    void cancelRefundsCreatorOnce() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, LocalDate.now());
        participant(bet, creator);

        groupBetService.cancelBet(group.getId(), bet.getId(), creator.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.CANCELED);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(creator, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        // 참가 행은 남는다 — 취소는 판정이 아니므로 achieved/payout 도 비어 있어야 한다.
        assertThat(participantsOf(bet))
                .extracting(GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout)
                .containsExactly(tuple(null, null));
    }

    @Test
    @DisplayName("이중 취소 — 두 번째 호출은 BET_NOT_OPEN 으로 거절되고 환불은 한 번뿐이다(멱등)")
    void doubleCancelRefundsOnlyOnce() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, LocalDate.now());
        participant(bet, creator);

        groupBetService.cancelBet(group.getId(), bet.getId(), creator.getId());

        assertThatThrownBy(() -> groupBetService.cancelBet(group.getId(), bet.getId(), creator.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(creator, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
    }

    @Test
    @DisplayName("타인이 참가한 뒤에는 취소할 수 없다 — BET_CANCEL_HAS_OTHERS, 환불 없음")
    void cancelRejectedAfterOthersJoin() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User joiner = memberUser("참가자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, LocalDate.now());
        participant(bet, creator);
        participant(bet, joiner);

        assertThatThrownBy(() -> groupBetService.cancelBet(group.getId(), bet.getId(), creator.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(countOf(creator, CurrencyTransactionType.BET_REFUND)).isZero();
    }

    @Test
    @DisplayName("취소 ↔ 정산 배치 동시 실행 — CAS 게이트로 한 경로만 돈을 움직인다")
    void cancelAndSettleRaceMovesMoneyOnce() throws Exception {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        LocalDate betDate = LocalDate.now().minusDays(1);
        GroupChallengeBet bet = openBet(creator, betDate);
        participant(bet, creator);
        // 달성 상태 — 정산이 이기면 팟(=본인 판돈) 전액이 지급된다.
        focusStat(creator, betDate, GOAL_MINUTES);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> cancelCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.cancelBet(group.getId(), bet.getId(), creator.getId());
                } catch (GroupException e) {
                    // 정산이 먼저 끝났으면 BET_NOT_OPEN 으로 거절되는 것이 정상이다.
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_NOT_OPEN);
                }
            });
            Future<?> settleCall = pool.submit(() -> {
                await(startTogether);
                groupBetSettler.settle(bet.getId());
            });
            cancelCall.get(30, TimeUnit.SECONDS);
            settleCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 어느 쪽이 이겼든 "정확히 한 번, 한 종류"의 지급만 존재한다. 단독 참가라 금액은 어느
        // 경로든 STAKE 그대로다 — 잔액으로 이중 지급 여부를 최종 확인한다.
        GroupBetStatus finalStatus = statusOf(bet);
        assertThat(finalStatus).isIn(GroupBetStatus.CANCELED, GroupBetStatus.SETTLED);
        long refunds = countOf(creator, CurrencyTransactionType.BET_REFUND);
        long payouts = countOf(creator, CurrencyTransactionType.BET_PAYOUT);
        assertThat(refunds + payouts).isEqualTo(1);
        assertThat(finalStatus == GroupBetStatus.CANCELED ? refunds : payouts).isEqualTo(1);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    // ── 그룹 탈퇴 연동 ──────────────────────────────────────────────────

    @Test
    @DisplayName("참가자 탈퇴 — 참가 행 삭제 + 본인 환불, 남은 참가자가 2명 이상이면 내기는 계속된다")
    void withdrawDetachesAndRefundsParticipant() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, LocalDate.now());
        participant(bet, creator);
        participant(bet, leaver);
        participant(bet, third);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), third.getId());
        // 잔류 참가자에게는 아무 일도 없다.
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(balanceOf(third)).isEqualTo(BALANCE_AFTER_STAKE);
        // 그룹 멤버십도 실제로 빠졌다.
        assertThat(groupMemberRepository.findByGroup(group))
                .extracting(m -> m.getUser().getId())
                .doesNotContain(leaver.getId());
    }

    @Test
    @DisplayName("참가자 탈퇴로 개설자 혼자 남으면 — 자동 취소 + 개설자도 환불된다")
    void withdrawAutoCancelsWhenCreatorLeftAlone() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, LocalDate.now());
        participant(bet, creator);
        participant(bet, leaver);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.CANCELED);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(countOf(creator, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        // 탈퇴자 행만 지워지고 개설자 행은 남는다(취소는 판정이 아니므로 기록도 비어 있다).
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId())
                .containsExactly(creator.getId());
    }

    @Test
    @DisplayName("개설자 탈퇴 — 내기 전체 취소 + 전원 환불")
    void creatorWithdrawalCancelsBetAndRefundsEveryone() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User joinerA = memberUser("참가자A", GroupMemberRole.MEMBER);
        User joinerB = memberUser("참가자B", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, LocalDate.now());
        participant(bet, creator);
        participant(bet, joinerA);
        participant(bet, joinerB);

        groupMemberService.withdrawGroup(group.getId(), creator.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.CANCELED);
        for (User u : List.of(creator, joinerA, joinerB)) {
            assertThat(balanceOf(u)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
            assertThat(countOf(u, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        }
    }

    @Test
    @DisplayName("탈퇴자가 참가한 OPEN 내기가 여러 개면 전부 정리된다")
    void withdrawReleasesEveryOpenBet() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        // 내기 1 — 탈퇴 후에도 2명이 남아 계속된다.
        GroupChallengeBet continuing = openBet(creator, LocalDate.now().minusDays(1));
        participant(continuing, creator);
        participant(continuing, leaver);
        participant(continuing, third);
        // 내기 2 — 탈퇴자가 빠지면 개설자 혼자라 자동 취소된다.
        GroupChallengeBet autoCanceled = openBet(creator, LocalDate.now());
        participant(autoCanceled, creator);
        participant(autoCanceled, leaver);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(statusOf(continuing)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(statusOf(autoCanceled)).isEqualTo(GroupBetStatus.CANCELED);
        // 탈퇴자는 내기마다 각각 환불받는다(멱등키가 betId 스코프라 서로 충돌하지 않는다).
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(2);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    @Test
    @DisplayName("탈퇴 ↔ 정산 배치 동시 실행 — 행 잠금으로 직렬화되어 환불과 지급이 겹치지 않는다")
    void withdrawAndSettleRaceMovesMoneyOnce() throws Exception {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        LocalDate betDate = LocalDate.now().minusDays(1);
        GroupChallengeBet bet = openBet(creator, betDate);
        participant(bet, creator);
        participant(bet, leaver);
        // 탈퇴자만 달성 — 정산이 이기면 탈퇴자가 팟(60) 전액을 받고, 탈퇴가 이기면 환불(30)만 받는다.
        focusStat(leaver, betDate, GOAL_MINUTES);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                groupMemberService.withdrawGroup(group.getId(), leaver.getId());
            });
            Future<?> settleCall = pool.submit(() -> {
                await(startTogether);
                groupBetSettler.settle(bet.getId());
            });
            withdrawCall.get(30, TimeUnit.SECONDS);
            settleCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        long refunds = countOf(leaver, CurrencyTransactionType.BET_REFUND);
        long payouts = countOf(leaver, CurrencyTransactionType.BET_PAYOUT);
        GroupBetStatus finalStatus = statusOf(bet);
        if (finalStatus == GroupBetStatus.CANCELED) {
            // 탈퇴가 먼저 — 탈퇴자 환불 + 개설자 단독이라 자동 취소·환불. 정산은 스킵됐다.
            assertThat(refunds).isEqualTo(1);
            assertThat(payouts).isZero();
            assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
            assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        } else {
            // 정산이 먼저 — 탈퇴자가 승자로 팟 전액을 받고, 탈퇴 연동은 OPEN 이 아니라 손대지 않았다.
            assertThat(finalStatus).isEqualTo(GroupBetStatus.SETTLED);
            assertThat(payouts).isEqualTo(1);
            assertThat(refunds).isZero();
            assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
            assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
        }
        // 어느 쪽이든 탈퇴 자체는 완료돼 있어야 한다.
        assertThat(groupMemberRepository.findByGroup(group))
                .extracting(m -> m.getUser().getId())
                .doesNotContain(leaver.getId());
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}
