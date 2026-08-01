package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
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
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 정산 배치 통합 테스트 — 실제 DB 에 지갑·원장까지 반영해 <b>재실행 멱등</b>을 확인한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는다({@link IntegrationTestBase}). 정산은 내기 단위로
 * 커밋되어야 하고, "1회차 커밋 → 2회차 재실행" 이라는 시나리오 자체가 커밋을 전제하기 때문이다.
 * 테스트가 만든 데이터는 롤백되지 않으므로 {@code @AfterEach} 에서 직접 지운다.
 *
 * <p>순수 분배 규칙은 {@link GroupBetPayoutCalculatorTest}(단위)가 이미 고정한다. 여기서 보는 것은
 * 그 결과가 지갑·원장·참가자 행에 <b>정확히 한 번</b> 반영되는지다.
 */
class GroupBetSettlementIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetSettlementService groupBetSettlementService;
    @Autowired
    GroupBetSettler groupBetSettler;
    @Autowired
    GroupRepository groupRepository;
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

    /** 정산 대상은 "어제까지"다 — 기준일(today)보다 앞선 날짜여야 배치가 집어간다. */
    private final LocalDate today = LocalDate.of(2026, 8, 1);
    private final LocalDate betDate = today.minusDays(1);

    private Group group;
    private GroupChallenge challenge;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> bets = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<DailyFocusStat> stats = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = challengeWithGoal(GOAL_MINUTES);
    }

    @AfterEach
    void tearDown() {
        // FK 역순으로 지운다. 다른 테스트 클래스는 @Transactional 롤백이라 남은 행이 곧 오염이다.
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        bets.forEach(b -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(b.getId()))));
        groupChallengeBetRepository.deleteAll(bets);
        dailyFocusStatRepository.deleteAll(stats);
        challenges.forEach(c -> groupChallengeDurationRepository.findById(c.getId())
                .ifPresent(groupChallengeDurationRepository::delete));
        groupChallengeRepository.deleteAll(challenges);
        users.forEach(u -> userWalletRepository.deleteById(u.getId()));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        bets.clear();
        challenges.clear();
        stats.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    /** DURATION 상세까지 갖춘 정상 챌린지. */
    private GroupChallenge challengeWithGoal(int goalMinutes) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        challenges.add(saved);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).durationMinutes(goalMinutes).build());
        return saved;
    }

    /** 판돈을 이미 낸(잔액 70) 유저. */
    private User stakedUser(String nickname) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        users.add(user);
        return user;
    }

    private GroupChallengeBet openBet(GroupChallenge target) {
        return openBetWithStake(target, STAKE);
    }

    private GroupChallengeBet openBetWithStake(GroupChallenge target, int stake) {
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(target)
                .creatorUser(users.isEmpty() ? stakedUser("개설자") : users.get(0))
                .stake(stake)
                .betDate(betDate)
                .status(GroupBetStatus.OPEN)
                .build());
        bets.add(bet);
        return bet;
    }

    /** 참가자 등록 + 그날의 집중 기록. {@code focusMinutes} 가 목표 이상이면 승자가 된다. */
    private void participant(GroupChallengeBet bet, User user, int focusMinutes) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
        stats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(betDate).totalFocusSeconds(focusMinutes * 60).build()));
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private List<CurrencyTransaction> transactionsOf(User user, CurrencyTransactionType type) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == type)
                .toList();
    }

    private GroupBetStatus statusOf(GroupChallengeBet bet) {
        return groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getStatus();
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBet bet) {
        return groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId()));
    }

    // ── 테스트 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("배치 재실행 — 2회차는 대상 0건, 지갑·원장이 한 번만 반영된다")
    void rerunningBatchDoesNotPayTwice() {
        User winner = stakedUser("승자");
        User loser = stakedUser("패자");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, winner, GOAL_MINUTES);        // 목표 정확히 달성
        participant(bet, loser, GOAL_MINUTES - 1);     // 1분 모자람

        GroupBetSettlementSummaryResponse first = groupBetSettlementService.settleDueBets(today);

        assertThat(first.settledCount()).isEqualTo(1);
        assertThat(first.failedCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.SETTLED);
        // 팟 60 전액이 유일한 승자에게. 패자는 판돈을 잃는다.
        assertThat(balanceOf(winner)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(loser)).isEqualTo(BALANCE_AFTER_STAKE);

        GroupBetSettlementSummaryResponse second = groupBetSettlementService.settleDueBets(today);

        // status 가드에 걸려 대상 자체가 잡히지 않는다(멱등 1차 방어).
        assertThat(second.targetCount()).isZero();
        assertThat(second.settledCount()).isZero();
        assertThat(balanceOf(winner)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(loser)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT)).hasSize(1);
    }

    @Test
    @DisplayName("정산 결과가 참가자 행에 기록된다 — achieved/payout")
    void recordsSettlementOnParticipantRows() {
        User winner = stakedUser("승자");
        User loser = stakedUser("패자");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, winner, GOAL_MINUTES + 60);
        participant(bet, loser, 0);

        groupBetSettlementService.settleDueBets(today);

        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(
                        tuple(winner.getId(), true, STAKE * 2),
                        tuple(loser.getId(), false, 0));
    }

    @Test
    @DisplayName("settler 직접 재호출 — 이미 정산된 내기는 스킵되고 지급도 다시 일어나지 않는다")
    void settlerSkipsAlreadySettledBet() {
        User winner = stakedUser("승자");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, winner, GOAL_MINUTES);

        assertThat(groupBetSettler.settle(bet.getId()))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));
        int afterFirst = balanceOf(winner);

        // 상태는 SETTLED 그대로지만 applied=false — 이 호출은 아무 것도 지급하지 않았다.
        assertThat(groupBetSettler.settle(bet.getId()))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, false));

        assertThat(balanceOf(winner)).isEqualTo(afterFirst);
        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT)).hasSize(1);
    }

    @Test
    @DisplayName("스케줄러와 수동 트리거가 동시에 같은 내기를 집어도 지급은 한 번뿐이다 — 정산 CAS 게이트")
    void concurrentSettleClaimsGateOnlyOnce() throws Exception {
        User winner = stakedUser("승자");
        User loser = stakedUser("패자");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, winner, GOAL_MINUTES);
        participant(bet, loser, 0);

        // 두 스레드를 같은 지점에서 동시에 출발시켜 "읽고-계산하고-쓰는" 구간을 실제로 겹치게 만든다.
        // 04:00 배치와 dev/staging 수동 트리거(POST /groups/bets/settle)가 겹치는 시나리오다.
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<GroupBetSettler.SettleResult>> futures = pool.invokeAll(
                    List.of(settleTask(bet, startTogether), settleTask(bet, startTogether)));

            List<GroupBetSettler.SettleResult> results = new ArrayList<>();
            for (Future<GroupBetSettler.SettleResult> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }

            // 두 호출 모두 SETTLED 로 정상 종료한다 — 늦게 온 트랜잭션은 CAS 가 0행을 돌려줘
            // 지급을 건너뛴다(예전엔 멱등키 유니크 위반으로 한쪽이 예외로 터졌다).
            assertThat(results).extracting(GroupBetSettler.SettleResult::status)
                    .containsExactly(GroupBetStatus.SETTLED, GroupBetStatus.SETTLED);
            // 다만 "실제로 지급한" 쪽은 정확히 하나다 — CAS 에서 밀린 쪽은 applied=false 로 자기 성과가
            // 아님을 알린다(배치 요약이 같은 내기를 두 번 세지 않는 근거).
            assertThat(results).filteredOn(GroupBetSettler.SettleResult::applied).hasSize(1);
        } finally {
            pool.shutdownNow();
        }

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT)).hasSize(1);
        assertThat(balanceOf(winner)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(loser)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(participantsOf(bet))
                .extracting(GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(STAKE * 2, 0);
    }

    private Callable<GroupBetSettler.SettleResult> settleTask(
            GroupChallengeBet bet, CyclicBarrier startTogether) {
        return () -> {
            startTogether.await(30, TimeUnit.SECONDS);
            return groupBetSettler.settle(bet.getId());
        };
    }

    @Test
    @DisplayName("달성자 0명 → REFUNDED, 전원이 판돈을 그대로 돌려받는다(BET_REFUND)")
    void refundsEveryoneWhenNoWinner() {
        User a = stakedUser("A");
        User b = stakedUser("B");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, a, 10);
        participant(bet, b, 0);

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.refundedCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.REFUNDED);
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(balanceOf(b)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(transactionsOf(a, CurrencyTransactionType.BET_REFUND)).hasSize(1);
        assertThat(transactionsOf(b, CurrencyTransactionType.BET_REFUND)).hasSize(1);
    }

    @Test
    @DisplayName("한 건이 터져도 나머지 내기는 정산된다 — 내기 단위 트랜잭션")
    void oneFailingBetDoesNotBlockOthers() {
        User healthy = stakedUser("정상");
        User broken = stakedUser("유실");

        GroupChallengeBet goodBet = openBet(challenge);
        participant(goodBet, healthy, GOAL_MINUTES);

        // DURATION 상세가 없는 챌린지 = 목표를 몰라 정산 불가 → 이 건만 예외로 롤백된다.
        GroupChallenge orphan = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        challenges.add(orphan);
        GroupChallengeBet brokenBet = openBet(orphan);
        participant(brokenBet, broken, GOAL_MINUTES);

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.failedCount()).isEqualTo(1);
        assertThat(statusOf(goodBet)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(statusOf(brokenBet)).isEqualTo(GroupBetStatus.OPEN);   // 롤백되어 그대로 남는다
        assertThat(balanceOf(healthy)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(balanceOf(broken)).isEqualTo(BALANCE_AFTER_STAKE);     // 미정산 = 지급 없음
    }

    @Test
    @DisplayName("당일 내기는 배치 대상이 아니다 — bet_date < 기준일만 정산한다")
    void doesNotSettleTodaysBet() {
        User user = stakedUser("참가자");
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).creatorUser(user)
                .stake(STAKE).betDate(today).status(GroupBetStatus.OPEN).build());
        bets.add(bet);
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(user)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("집중 기록이 아예 없는 참가자는 0분으로 판정된다")
    void treatsMissingFocusStatAsZero() {
        User noStat = stakedUser("무기록");
        GroupChallengeBet bet = openBet(challenge);
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(noStat).build());

        groupBetSettlementService.settleDueBets(today);

        // 달성자 0명 → 환불
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.REFUNDED);
        assertThat(balanceOf(noStat)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    @Test
    @DisplayName("정산 대상이 없으면 조용히 0건으로 끝난다")
    void settlesNothingWhenNoDueBets() {
        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isZero();
        assertThat(summary.failedCount()).isZero();
    }

    @Test
    @DisplayName("잔여(나머지)는 진행분 최다 승자에게 실제로 지급된다 — 팟이 한 푼도 새지 않는다")
    void remainderGoesToTopProgressWinner() {
        // 판돈 10 × 4명 = 팟 40, 승자 3명 → 13씩 + 나머지 1
        User top = stakedUser("최다");
        User second = stakedUser("차순");
        User third = stakedUser("삼순");
        User loser = stakedUser("패자");
        GroupChallengeBet bet = openBetWithStake(challenge, 10);
        participant(bet, top, GOAL_MINUTES + 100);
        participant(bet, second, GOAL_MINUTES + 10);
        participant(bet, third, GOAL_MINUTES + 5);
        participant(bet, loser, 0);

        groupBetSettlementService.settleDueBets(today);

        int pot = 10 * 4;
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(
                        tuple(top.getId(), 14),      // 13 + 나머지 1
                        tuple(second.getId(), 13),
                        tuple(third.getId(), 13),
                        tuple(loser.getId(), 0));
        // 팟 보존 — 지급 합계가 정확히 팟과 같다(증발도 초과 지급도 없음).
        assertThat(participantsOf(bet).stream()
                .mapToInt(GroupChallengeBetParticipant::getPayout).sum()).isEqualTo(pot);
        assertThat(balanceOf(top)).isEqualTo(BALANCE_AFTER_STAKE + 14);
    }

    @Test
    @DisplayName("멱등키는 내기·유저별로 유일하다 — 같은 유저가 다른 내기에서 각각 지급받는다")
    void idempotencyKeyIsScopedPerBet() {
        User winner = stakedUser("승자");

        GroupChallengeBet first = openBet(challenge);
        participant(first, winner, GOAL_MINUTES);

        GroupChallenge other = challengeWithGoal(GOAL_MINUTES);
        GroupChallengeBet secondBet = openBet(other);
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(secondBet).user(winner).build());

        groupBetSettlementService.settleDueBets(today);

        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT)).hasSize(2);
        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT))
                .extracting(CurrencyTransaction::getIdempotencyKey)
                .containsExactlyInAnyOrder(
                        "bet:" + first.getId() + ":payout:" + winner.getId(),
                        "bet:" + secondBet.getId() + ":payout:" + winner.getId());
    }
}
