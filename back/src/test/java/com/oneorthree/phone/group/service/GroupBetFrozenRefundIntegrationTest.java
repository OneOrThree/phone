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
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 24시간 초과 동결 회차의 <b>자동 무효화 + 전원 환불</b> 통합 테스트 (정책 §E1, GROMO-1258).
 *
 * <p>정산 영구 실패 3종(참가자 유실 · 챌린지 목표 유실 · 분배 불변식 위반)은 다음날 크론도 같은
 * 지점에서 실패하므로, 감지만 하던 종전에는 참가비가 사람 개입 없이는 영원히 묶였다. 여기서는
 * 실제로 정산이 불가능한 회차(챌린지 목표 유실)를 만들어 두고, 09:00 스윕이 그 회차를
 * {@link GroupBetStatus#REFUNDED} 로 닫고 참가비를 되돌리는지 · 재실행이 멱등인지를 실 DB 로 고정한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@link GroupBetCancelWithdrawIntegrationTest} 와
 * 같다 — 처분이 건별 트랜잭션이라 커밋이 전제다. 정리는 {@code @AfterEach} 가 직접 한다.
 */
class GroupBetFrozenRefundIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetFreezeMonitor groupBetFreezeMonitor;
    @Autowired
    GroupBetSettlementService groupBetSettlementService;
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
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    JdbcTemplate jdbcTemplate;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int STAKE = 30;
    /** 판돈 차감 후 잔액 — 참가 시점에 이미 STAKE 만큼 빠져 있는 상태를 재현한다. */
    private static final int BALANCE_AFTER_STAKE = 70;
    /** 동결 임계({@code bet_date ≤ 오늘 − 2})를 확실히 넘긴 날짜. */
    private static final int FROZEN_DAYS_AGO = 3;

    private Group group;
    /** 목표(duration) 행이 <b>없는</b> 챌린지 — 정산이 목표를 몰라 매번 실패하는 영구 실패 상태다. */
    private GroupChallenge brokenChallenge;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> bets = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        brokenChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
    }

    @AfterEach
    void tearDown() {
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        bets.forEach(b -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(b.getId()))));
        groupChallengeBetRepository.deleteAll(bets);
        groupChallengeDurationRepository.findById(brokenChallenge.getId())
                .ifPresent(groupChallengeDurationRepository::delete);
        groupChallengeRepository.delete(brokenChallenge);
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        bets.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User memberUser(String nickname) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        groupMemberRepository.save(GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.MEMBER).build());
        users.add(user);
        return user;
    }

    private GroupChallengeBet frozenBet(User creator) {
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(brokenChallenge)
                .creatorUser(creator)
                .stake(STAKE)
                .betDate(LocalDate.now(KST).minusDays(FROZEN_DAYS_AGO))
                .status(GroupBetStatus.OPEN)
                .build());
        bets.add(bet);
        return bet;
    }

    private GroupChallengeBetParticipant participant(GroupChallengeBet bet, User user) {
        return groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
    }

    private GroupBetStatus statusOf(GroupChallengeBet bet) {
        return groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getStatus();
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private List<String> refundKeysOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_REFUND)
                .map(CurrencyTransaction::getIdempotencyKey)
                .toList();
    }

    // ── 시나리오 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("정산이 영구 실패하는 회차는 크론이 아무리 돌아도 OPEN 에 갇힌다 — 자동 환불의 전제")
    void permanentSettlementFailureKeepsBetOpen() {
        User creator = memberUser("개설자");
        GroupChallengeBet bet = frozenBet(creator);
        participant(bet, creator);

        // 목표(duration)가 없어 GroupBetSettler 가 IllegalStateException 으로 이 건만 롤백한다.
        groupBetSettlementService.settleDueBets(LocalDate.now(KST));
        groupBetSettlementService.settleDueBets(LocalDate.now(KST));

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("24h 초과 동결 — REFUNDED 로 닫히고 전원이 정확히 한 번 환불된다")
    void frozenBetIsVoidedAndEveryoneRefunded() {
        User creator = memberUser("개설자");
        User joiner = memberUser("참가자");
        GroupChallengeBet bet = frozenBet(creator);
        GroupChallengeBetParticipant creatorRow = participant(bet, creator);
        GroupChallengeBetParticipant joinerRow = participant(bet, joiner);

        GroupBetFreezeMonitor.FrozenSweepSummary summary = groupBetFreezeMonitor.sweepFrozenBets();

        assertThat(summary.detectedCount()).isPositive();
        assertThat(summary.failedCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.REFUNDED);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        // 멱등키의 축은 참가 행이다 — 취소·철회·탈퇴 환불과 같은 축이라야 경로가 겹쳐도 원장
        // 유니크가 두 번째 기입을 거절한다(정책 §C9, GROMO-1258).
        assertThat(refundKeysOf(creator))
                .containsExactly("bet:" + bet.getId() + ":refund:" + creatorRow.getId());
        assertThat(refundKeysOf(joiner))
                .containsExactly("bet:" + bet.getId() + ":refund:" + joinerRow.getId());
        // 참가 행은 남는다 — 명단·인원수는 그날의 사실이고, 판정 결과가 비어 있는 것이
        // "판정하지 못한 채 닫혔다"의 표현이다.
        assertThat(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId())))
                .hasSize(2)
                .allSatisfy(p -> assertThat(p.getPayout()).isNull());
    }

    @Test
    @DisplayName("재실행 멱등 — 두 번째 스윕은 대상으로도 집히지 않고 환불도 늘지 않는다")
    void secondSweepIsIdempotent() {
        User creator = memberUser("개설자");
        GroupChallengeBet bet = frozenBet(creator);
        participant(bet, creator);

        groupBetFreezeMonitor.sweepFrozenBets();
        GroupBetFreezeMonitor.FrozenSweepSummary second = groupBetFreezeMonitor.sweepFrozenBets();

        // 이미 OPEN 이 아니므로 감지 쿼리(status=OPEN)에서부터 빠진다 — 1차 방어.
        assertThat(second.refundedCount()).isZero();
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.REFUNDED);
        assertThat(refundKeysOf(creator)).hasSize(1);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    @Test
    @DisplayName("환불 멱등키 2차 방어 — 상태를 OPEN 으로 되돌려 다시 처분해도 돈은 한 번만 움직인다")
    void refundKeyBlocksSecondCreditEvenIfStatusReopens() {
        // status CAS 는 정상 흐름의 1차 게이트일 뿐이다. 운영 사고나 수동 개입으로 status 가 되돌아가도
        // 원장 유니크가 최후 방어선으로 남아야 한다 — 그 계층이 실제로 작동하는지를 잠근다.
        User creator = memberUser("개설자");
        GroupChallengeBet bet = frozenBet(creator);
        participant(bet, creator);
        groupBetFreezeMonitor.sweepFrozenBets();

        // status 전이는 엔티티 세터가 아니라 CAS 가 소유하므로(도메인 계약) SQL 로 직접 되돌린다.
        jdbcTemplate.update("UPDATE group_challenge_bets SET status = 'OPEN' WHERE id = ?", bet.getId());

        groupBetFreezeMonitor.sweepFrozenBets();

        assertThat(refundKeysOf(creator)).hasSize(1);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    @Test
    @DisplayName("아직 정산 기회가 남은 어제 회차는 건드리지 않는다 — 임계는 bet_date ≤ 오늘−2")
    void yesterdayBetIsNotSweptYet() {
        User creator = memberUser("개설자");
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(brokenChallenge)
                .creatorUser(creator)
                .stake(STAKE)
                .betDate(LocalDate.now(KST).minusDays(1))
                .status(GroupBetStatus.OPEN)
                .build());
        bets.add(bet);
        participant(bet, creator);

        groupBetFreezeMonitor.sweepFrozenBets(Instant.now());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
    }
}
