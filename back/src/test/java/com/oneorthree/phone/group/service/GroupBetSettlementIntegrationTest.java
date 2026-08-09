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
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
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

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
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
 * 2계층 재편(GROMO-1262) 후 정산 단위는 <b>회차</b>이고 멱등키 축은 참가 행 id 다(FR-42).
 *
 * <p>{@code @Transactional} 을 붙이지 않는다({@link IntegrationTestBase}). 정산은 회차 단위로
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
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
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

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 30;
    /** 참가비 차감 후 잔액. 참가 시점에 이미 STAKE 만큼 빠져 있는 상태를 재현한다. */
    private static final int BALANCE_AFTER_STAKE = 70;

    /** 정산 대상은 "어제까지"다 — 기준일(today)보다 앞선 날짜여야 배치가 집어간다. */
    private final LocalDate today = LocalDate.of(2026, 8, 1);
    private final LocalDate sessionDate = today.minusDays(1);

    private Group group;
    private GroupChallenge challenge;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> configs = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();
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
        betSessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(betSessions);
        groupChallengeBetRepository.deleteAll(configs);
        dailyFocusStatRepository.deleteAll(stats);
        challenges.forEach(c -> groupChallengeDurationRepository.findById(c.getId())
                .ifPresent(groupChallengeDurationRepository::delete));
        groupChallengeRepository.deleteAll(challenges);
        // 탈퇴자 픽스처는 지갑이 없다 — deleteById 대신 존재할 때만 지운다.
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        configs.clear();
        betSessions.clear();
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

    /** 참가비를 이미 낸(잔액 70) 유저. */
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

    private GroupChallengeBetSession openSession(GroupChallenge target) {
        return openSession(target, STAKE, sessionDate);
    }

    /** 설정 + 회차(미션 스냅샷 박제) 픽스처 — 재편 후 정산 대상은 회차 행이다. */
    private GroupChallengeBetSession openSession(GroupChallenge target, int stake, LocalDate date) {
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(target).stake(stake).enabled(true).build());
        configs.add(config);
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config)
                        .group(group)
                        .challenge(target)
                        .sessionDate(date)
                        .stake(stake)
                        .goalMinutes(GOAL_MINUTES)
                        .missionCategory(target.getCategory())
                        .missionType(target.getType())
                        .status(GroupBetStatus.OPEN)
                        .startsAt(date.atStartOfDay(KST).toInstant())
                        .joinClosesAt(closesAt)
                        .closesAt(closesAt)
                        .settleAfter(closesAt)
                        .build());
        betSessions.add(session);
        return session;
    }

    /** 참가자 등록 + 그날의 집중 기록. {@code focusMinutes} 가 목표 이상이면 승자가 된다. */
    private GroupChallengeBetParticipant participant(
            GroupChallengeBetSession session, User user, int focusMinutes) {
        GroupChallengeBetParticipant saved = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
        stats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(session.getSessionDate())
                .totalFocusSeconds(focusMinutes * 60).build()));
        return saved;
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private List<CurrencyTransaction> transactionsOf(User user, CurrencyTransactionType type) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == type)
                .toList();
    }

    private GroupBetStatus statusOf(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow().getStatus();
    }

    /** 목표 스냅샷(GROMO-1263) — DB 재조회로 읽는다. */
    private Integer goalMinutesOf(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow().getGoalMinutes();
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBetSession session) {
        return groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(session.getId()));
    }

    // ── 테스트 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("배치 재실행 — 2회차는 대상 0건, 지갑·원장이 한 번만 반영된다")
    void rerunningBatchDoesNotPayTwice() {
        User winner = stakedUser("승자");
        User loser = stakedUser("패자");
        GroupChallengeBetSession session = openSession(challenge);
        participant(session, winner, GOAL_MINUTES);        // 목표 정확히 달성
        participant(session, loser, GOAL_MINUTES - 1);     // 1분 모자람

        GroupBetSettlementSummaryResponse first = groupBetSettlementService.settleDueBets(today);

        assertThat(first.settledCount()).isEqualTo(1);
        assertThat(first.failedCount()).isZero();
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
        // 팟 60 전액이 유일한 승자에게. 패자는 참가비를 잃는다.
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
        GroupChallengeBetSession session = openSession(challenge);
        participant(session, winner, GOAL_MINUTES + 60);
        participant(session, loser, 0);

        groupBetSettlementService.settleDueBets(today);

        // 판정에 쓴 실측 분이 그대로 남는다 — 결과 모달의 "기록/목표" 근거(GROMO-1207).
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(
                        tuple(winner.getId(), true, STAKE * 2, GOAL_MINUTES + 60),
                        tuple(loser.getId(), false, 0, 0));
        // 목표 분 스냅샷은 회차에 박제돼 있다(GROMO-1263) — 챌린지 목표가 뒤에 바뀌어도 불변이다.
        assertThat(goalMinutesOf(session)).isEqualTo(GOAL_MINUTES);
    }

    @Test
    @DisplayName("settler 직접 재호출 — 이미 정산된 회차는 스킵되고 지급도 다시 일어나지 않는다")
    void settlerSkipsAlreadySettledSession() {
        User winner = stakedUser("승자");
        GroupChallengeBetSession session = openSession(challenge);
        participant(session, winner, GOAL_MINUTES);

        assertThat(groupBetSettler.settle(session.getId()))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));
        int afterFirst = balanceOf(winner);

        // 상태는 SETTLED 그대로지만 applied=false — 이 호출은 아무 것도 지급하지 않았다.
        assertThat(groupBetSettler.settle(session.getId()))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, false));

        assertThat(balanceOf(winner)).isEqualTo(afterFirst);
        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT)).hasSize(1);
    }

    @Test
    @DisplayName("스케줄러와 수동 트리거가 동시에 같은 회차를 집어도 지급은 한 번뿐이다 — 정산 CAS 게이트")
    void concurrentSettleClaimsGateOnlyOnce() throws Exception {
        User winner = stakedUser("승자");
        User loser = stakedUser("패자");
        GroupChallengeBetSession session = openSession(challenge);
        participant(session, winner, GOAL_MINUTES);
        participant(session, loser, 0);

        // 두 스레드를 같은 지점에서 동시에 출발시켜 "읽고-계산하고-쓰는" 구간을 실제로 겹치게 만든다.
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<GroupBetSettler.SettleResult>> futures = pool.invokeAll(
                    List.of(settleTask(session, startTogether), settleTask(session, startTogether)));

            List<GroupBetSettler.SettleResult> results = new ArrayList<>();
            for (Future<GroupBetSettler.SettleResult> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }

            // 두 호출 모두 SETTLED 로 정상 종료한다 — 늦게 온 트랜잭션은 CAS 가 0행을 돌려줘
            // 지급을 건너뛴다.
            assertThat(results).extracting(GroupBetSettler.SettleResult::status)
                    .containsExactly(GroupBetStatus.SETTLED, GroupBetStatus.SETTLED);
            // "실제로 지급한" 쪽은 정확히 하나다 — CAS 에서 밀린 쪽은 applied=false.
            assertThat(results).filteredOn(GroupBetSettler.SettleResult::applied).hasSize(1);
        } finally {
            pool.shutdownNow();
        }

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT)).hasSize(1);
        assertThat(balanceOf(winner)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(loser)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(participantsOf(session))
                .extracting(GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(STAKE * 2, 0);
    }

    private Callable<GroupBetSettler.SettleResult> settleTask(
            GroupChallengeBetSession session, CyclicBarrier startTogether) {
        return () -> {
            startTogether.await(30, TimeUnit.SECONDS);
            return groupBetSettler.settle(session.getId());
        };
    }

    @Test
    @DisplayName("달성자 0명 → FORFEITED, 팟 전액 소멸 — 지갑도 원장도 움직이지 않는다")
    void forfeitsPotWhenNoWinner() {
        User a = stakedUser("A");
        User b = stakedUser("B");
        GroupChallengeBetSession session = openSession(challenge);
        participant(session, a, 10);
        participant(session, b, 0);

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.forfeitedCount()).isEqualTo(1);
        assertThat(summary.settledCount()).isZero();
        assertThat(summary.refundedCount()).isZero();
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.FORFEITED);
        // 참가비는 돌아오지 않는다 — 차감된 잔액 그대로가 몰수의 결과다.
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(balanceOf(b)).isEqualTo(BALANCE_AFTER_STAKE);
        // 원장 무기록 — 몰수는 어떤 지급/환불 기입도 남기지 않는다(차감 기록만이 흔적이다).
        assertThat(transactionsOf(a, CurrencyTransactionType.BET_REFUND)).isEmpty();
        assertThat(transactionsOf(b, CurrencyTransactionType.BET_REFUND)).isEmpty();
        assertThat(transactionsOf(a, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        assertThat(transactionsOf(b, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        // 판정 결과는 참가자 행에 남는다 — 전원 미달성·payout 0.
        assertThat(participantsOf(session))
                .extracting(GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(tuple(false, 0, 10), tuple(false, 0, 0));
        assertThat(goalMinutesOf(session)).isEqualTo(GOAL_MINUTES);
    }

    @Test
    @DisplayName("몰수 재실행 — 2회차는 대상 0건, 잔액이 계속 그대로다(멱등)")
    void rerunningForfeitDoesNotChangeAnything() {
        User a = stakedUser("A");
        GroupChallengeBetSession session = openSession(challenge);
        participant(session, a, 0);

        groupBetSettlementService.settleDueBets(today);
        GroupBetSettlementSummaryResponse second = groupBetSettlementService.settleDueBets(today);

        assertThat(second.targetCount()).isZero();
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.FORFEITED);
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("한 건이 터져도 나머지 회차는 정산된다 — 회차 단위 트랜잭션")
    void oneFailingSessionDoesNotBlockOthers() {
        User healthy = stakedUser("정상");
        User broken = stakedUser("유실");

        GroupChallengeBetSession goodSession = openSession(challenge);
        participant(goodSession, healthy, GOAL_MINUTES);

        // DURATION 상세가 없고 목표 스냅샷도 없는 회차 = 목표를 몰라 정산 불가 → 이 건만 롤백된다.
        GroupChallenge orphan = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        challenges.add(orphan);
        GroupChallengeBet orphanConfig = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(orphan).stake(STAKE).enabled(true).build());
        configs.add(orphanConfig);
        Instant closesAt = sessionDate.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession brokenSession = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(orphanConfig).group(group).challenge(orphan)
                        .sessionDate(sessionDate).stake(STAKE).goalMinutes(null)
                        .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                        .status(GroupBetStatus.OPEN)
                        .startsAt(sessionDate.atStartOfDay(KST).toInstant())
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .build());
        betSessions.add(brokenSession);
        participant(brokenSession, broken, GOAL_MINUTES);

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.failedCount()).isEqualTo(1);
        assertThat(statusOf(goodSession)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(statusOf(brokenSession)).isEqualTo(GroupBetStatus.OPEN);   // 롤백되어 그대로 남는다
        assertThat(balanceOf(healthy)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(balanceOf(broken)).isEqualTo(BALANCE_AFTER_STAKE);     // 미정산 = 지급 없음
    }

    @Test
    @DisplayName("당일 회차는 배치 대상이 아니다 — session_date < 기준일만 정산한다")
    void doesNotSettleTodaysSession() {
        User user = stakedUser("참가자");
        GroupChallengeBetSession session = openSession(challenge, STAKE, today);
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isZero();
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(user)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("미래(내일) 회차는 배치 대상이 아니다 — 조기 정산·몰수·환불 없이 OPEN 그대로 남는다(GROMO-1103)")
    void doesNotSettleTomorrowsSession() {
        User user = stakedUser("참가자");
        GroupChallengeBetSession session = openSession(challenge, STAKE, today.plusDays(1));
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isZero();
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        // 지갑·원장 무변동 — 조기 정산은 물론 FORFEITED 몰수·환불 어느 쪽으로도 돈이 움직이지 않는다.
        assertThat(balanceOf(user)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(transactionsOf(user, CurrencyTransactionType.BET_REFUND)).isEmpty();
        assertThat(transactionsOf(user, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        // 판정 결과도 기록되지 않는다 — 참가 행은 아직 미판정(null) 그대로다.
        assertThat(participantsOf(session))
                .extracting(GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout)
                .containsExactly(tuple(null, null));
    }

    @Test
    @DisplayName("집중 기록이 아예 없는 참가자는 0분으로 판정된다")
    void treatsMissingFocusStatAsZero() {
        User noStat = stakedUser("무기록");
        GroupChallengeBetSession session = openSession(challenge);
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(noStat).build());

        groupBetSettlementService.settleDueBets(today);

        // 달성자 0명 → 몰수. 참가비는 돌아오지 않는다.
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.FORFEITED);
        assertThat(balanceOf(noStat)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("탈퇴한(지갑 없는) 참가자가 껴 있어도 정산은 끝난다 — 롤백되면 참가비가 영구히 묶인다")
    void settlesEvenWhenAParticipantHasWithdrawn() {
        User staying = stakedUser("잔류");
        User withdrawn = withdrawnUser("탈퇴자");
        GroupChallengeBetSession session = openSession(challenge);
        participant(session, staying, GOAL_MINUTES);
        // 탈퇴 시 daily_focus_stats 는 nullifyUser 로 익명화되므로 통계 행이 남지 않는다(0분 판정).
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(withdrawn).build());

        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        // 잔류자가 유일한 승자 — 탈퇴자 행이 있어도 정산이 터지지 않고 팟 전액이 승자에게 간다.
        assertThat(summary.settledCount()).isEqualTo(1);
        assertThat(summary.failedCount()).isZero();
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(balanceOf(staying)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(transactionsOf(staying, CurrencyTransactionType.BET_PAYOUT)).hasSize(1);
        // 탈퇴자에게는 원장 기입도 없다 — 지갑이 이미 없고, 패자라 지급분도 0 이다.
        assertThat(transactionsOf(withdrawn, CurrencyTransactionType.BET_PAYOUT)).isEmpty();
        assertThat(userWalletRepository.findById(withdrawn.getId())).isEmpty();
        // 참가 행에는 계산된 몫이 그대로 기록된다(분배 계산의 근거 보존).
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(
                        tuple(staying.getId(), STAKE * 2),
                        tuple(withdrawn.getId(), 0));
    }

    @Test
    @DisplayName("정산 대상이 없으면 조용히 0건으로 끝난다")
    void settlesNothingWhenNoDueSessions() {
        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(today);

        assertThat(summary.targetCount()).isZero();
        assertThat(summary.failedCount()).isZero();
    }

    @Test
    @DisplayName("잔여(나머지)는 진행분 최다 승자에게 실제로 지급된다 — 팟이 한 푼도 새지 않는다")
    void remainderGoesToTopProgressWinner() {
        // 참가비 10 × 4명 = 팟 40, 승자 3명 → 13씩 + 나머지 1
        User top = stakedUser("최다");
        User second = stakedUser("차순");
        User third = stakedUser("삼순");
        User loser = stakedUser("패자");
        GroupChallengeBetSession session = openSession(challenge, 10, sessionDate);
        participant(session, top, GOAL_MINUTES + 100);
        participant(session, second, GOAL_MINUTES + 10);
        participant(session, third, GOAL_MINUTES + 5);
        participant(session, loser, 0);

        groupBetSettlementService.settleDueBets(today);

        int pot = 10 * 4;
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(
                        tuple(top.getId(), 14),      // 13 + 나머지 1
                        tuple(second.getId(), 13),
                        tuple(third.getId(), 13),
                        tuple(loser.getId(), 0));
        // 팟 보존 — 지급 합계가 정확히 팟과 같다(증발도 초과 지급도 없음).
        assertThat(participantsOf(session).stream()
                .mapToInt(GroupChallengeBetParticipant::getPayout).sum()).isEqualTo(pot);
        assertThat(balanceOf(top)).isEqualTo(BALANCE_AFTER_STAKE + 14);
    }

    @Test
    @DisplayName("지급 멱등키의 축은 참가 행 id 다(FR-42) — 같은 유저가 다른 회차에서 각각 지급받는다")
    void idempotencyKeyIsScopedPerParticipantRow() {
        User winner = stakedUser("승자");

        GroupChallengeBetSession first = openSession(challenge);
        GroupChallengeBetParticipant firstJoin = participant(first, winner, GOAL_MINUTES);

        GroupChallenge other = challengeWithGoal(GOAL_MINUTES);
        GroupChallengeBetSession second = openSession(other);
        GroupChallengeBetParticipant secondJoin = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(second).user(winner).build());

        groupBetSettlementService.settleDueBets(today);

        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT)).hasSize(2);
        assertThat(transactionsOf(winner, CurrencyTransactionType.BET_PAYOUT))
                .extracting(CurrencyTransaction::getIdempotencyKey)
                .containsExactlyInAnyOrder(
                        payoutKey(first.getId(), firstJoin.getId()),
                        payoutKey(second.getId(), secondJoin.getId()));
    }

    private static String payoutKey(UUID sessionId, UUID participantId) {
        return "session:" + sessionId + ":payout:" + participantId;
    }
}
