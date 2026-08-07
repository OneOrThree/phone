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
        // 탈퇴자 픽스처는 지갑이 없다 — deleteById 대신 존재할 때만 지운다.
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
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

    /**
     * 탈퇴 후의 참가자 — user 행은 소프트딜리트로 남고 지갑은 삭제된 상태다
     * ({@code UserService.withdraw}). 참가 행은 FK 때문에 그대로 남아 정산 대상에 계속 잡힌다.
     */
    private User withdrawnUser(String nickname) {
        User user = userRepository.save(
                User.builder().nickname(nickname).isGuest(false).isDeleted(true).build());
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

    /** 정산 근거 스냅샷(GROMO-1207) — DB 재조회로 읽는다(정산의 벌크 UPDATE 는 엔티티 캐시를 우회한다). */
    private Integer goalMinutesOf(GroupChallengeBet bet) {
        return groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getGoalMinutes();
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
    @DisplayName("정산 결과가 참가자 행에 기록된다 — achieved/payout + 판정 근거 progressMinutes(GROMO-1207)")
    void recordsSettlementOnParticipantRows() {
        User winner = stakedUser("승자");
        User loser = stakedUser("패자");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, winner, GOAL_MINUTES + 60);
        participant(bet, loser, 0);

        groupBetSettlementService.settleDueBets(today);

        // 판정에 쓴 실측 분이 그대로 남는다 — 결과 모달의 "기록/목표" 근거(GROMO-1207).
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(
                        tuple(winner.getId(), true, STAKE * 2, GOAL_MINUTES + 60),
                        tuple(loser.getId(), false, 0, 0));
        // 목표 분 스냅샷은 내기 행에 박제된다 — 챌린지 목표가 뒤에 바뀌어도 판정 근거는 보존된다.
        assertThat(goalMinutesOf(bet)).isEqualTo(GOAL_MINUTES);
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
    @DisplayName("달성자 0명 → FORFEITED, 팟 전액 소멸 — 지갑도 원장도 움직이지 않는다")
    void forfeitsPotWhenNoWinner() {
        User a = stakedUser("A");
        User b = stakedUser("B");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, a, 10);
        participant(bet, b, 0);

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.forfeitedCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isZero();
        assertThat(summary.refundedCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.FORFEITED);
        // 판돈은 돌아오지 않는다 — 차감된 잔액 그대로가 몰수의 결과다.
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(balanceOf(b)).isEqualTo(BALANCE_AFTER_STAKE);
        // 원장 무기록 — 몰수는 어떤 지급/환불 기입도 남기지 않는다(차감 기록만이 흔적이다).
        assertThat(transactionsOf(a, CurrencyTransactionType.BET_REFUND)).isEmpty();
        assertThat(transactionsOf(b, CurrencyTransactionType.BET_REFUND)).isEmpty();
        assertThat(transactionsOf(a, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        assertThat(transactionsOf(b, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        // 판정 결과는 참가자 행에 남는다 — 전원 미달성·payout 0. 몰수(FORFEITED) 분기도 판정
        // 근거(progressMinutes·goalMinutes)를 기록한다 — "왜 전원 몰수였나"의 증거다(GROMO-1207).
        assertThat(participantsOf(bet))
                .extracting(GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(tuple(false, 0, 10), tuple(false, 0, 0));
        assertThat(goalMinutesOf(bet)).isEqualTo(GOAL_MINUTES);
    }

    @Test
    @DisplayName("몰수 재실행 — 2회차는 대상 0건, 잔액이 계속 그대로다(멱등)")
    void rerunningForfeitDoesNotChangeAnything() {
        User a = stakedUser("A");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, a, 0);

        groupBetSettlementService.settleDueBets(today);
        GroupBetSettlementSummaryResponse second = groupBetSettlementService.settleDueBets(today);

        assertThat(second.targetCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.FORFEITED);
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE);
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
    @DisplayName("미래(내일) 내기는 배치 대상이 아니다 — 조기 정산·몰수·환불 없이 OPEN 그대로 남는다(GROMO-1103)")
    void doesNotSettleTomorrowsBet() {
        // 마감 후 "내일 시간대부터 적용"으로 열린 내기(bet_date=내일)가 오늘 밤 배치(FOCUS 01:00 /
        // SCREEN_TIME 12:00 KST)에 걸리면 집계가 시작되기도 전에 몰수된다 — 대상 선정이
        // bet_date < 기준일 쿼리라 미래 내기가 구조적으로 배제됨을 실 DB 로 고정한다(계약 §3).
        User user = stakedUser("참가자");
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).creatorUser(user)
                .stake(STAKE).betDate(today.plusDays(1)).status(GroupBetStatus.OPEN).build());
        bets.add(bet);
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        // 지갑·원장 무변동 — 조기 정산은 물론 FORFEITED 몰수·환불 어느 쪽으로도 돈이 움직이지 않는다.
        assertThat(balanceOf(user)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(transactionsOf(user, CurrencyTransactionType.BET_REFUND)).isEmpty();
        assertThat(transactionsOf(user, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        // 판정 결과도 기록되지 않는다 — 참가 행은 아직 미판정(null) 그대로다.
        assertThat(participantsOf(bet))
                .extracting(GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout)
                .containsExactly(tuple(null, null));
    }

    @Test
    @DisplayName("집중 기록이 아예 없는 참가자는 0분으로 판정된다")
    void treatsMissingFocusStatAsZero() {
        User noStat = stakedUser("무기록");
        GroupChallengeBet bet = openBet(challenge);
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(noStat).build());

        groupBetSettlementService.settleDueBets(today);

        // 달성자 0명 → 몰수. 판돈은 돌아오지 않는다.
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.FORFEITED);
        assertThat(balanceOf(noStat)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("탈퇴한(지갑 없는) 참가자가 껴 있어도 정산은 끝난다 — 롤백되면 판돈이 영구히 묶인다")
    void settlesEvenWhenAParticipantHasWithdrawn() {
        User staying = stakedUser("잔류");
        User withdrawn = withdrawnUser("탈퇴자");
        GroupChallengeBet bet = openBet(challenge);
        participant(bet, staying, GOAL_MINUTES);
        // 탈퇴 시 daily_focus_stats 는 nullifyUser 로 익명화되므로 통계 행이 남지 않는다(0분 판정).
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(withdrawn).build());

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        // 잔류자가 유일한 승자 — 탈퇴자 행이 있어도 정산이 터지지 않고 팟 전액이 승자에게 간다.
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.failedCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(balanceOf(staying)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(transactionsOf(staying, CurrencyTransactionType.BET_PAYOUT)).hasSize(1);
        // 탈퇴자에게는 원장 기입도 없다 — 지갑이 이미 없고, 패자라 지급분도 0 이다.
        assertThat(transactionsOf(withdrawn, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        assertThat(userWalletRepository.findById(withdrawn.getId())).isEmpty();
        // 참가 행에는 계산된 몫이 그대로 기록된다(분배 계산의 근거 보존).
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(
                        tuple(staying.getId(), STAKE * 2),
                        tuple(withdrawn.getId(), 0));
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
