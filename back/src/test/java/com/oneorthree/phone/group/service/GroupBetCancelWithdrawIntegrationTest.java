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
import java.time.ZoneId;
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
 * 내기 취소·그룹 탈퇴 연동 통합 테스트 — 환불이 <b>정확히 한 번</b>, 그리고 정산 배치·철회와 겹쳐도
 * 돈이 한 경로로만 움직이는지를 실 DB 로 고정한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@link GroupBetSettlementIntegrationTest} 와 같다
 * — 레이스 시나리오는 커밋(별도 스레드의 별도 트랜잭션)을 전제한다. 테스트 데이터는
 * {@code @AfterEach} 에서 직접 지운다.
 *
 * <p><b>날짜 기준은 KST 다</b>(GROMO-1258). 탈퇴 해제가 "시작 전 회차만" 건드리게 되면서
 * {@code bet_date} 가 시스템 존이 아니라 서비스와 같은 KST 로 해석돼야 판정이 일치한다 — UTC CI 에서
 * {@code LocalDate.now()} 로 잡은 "내일"은 KST 로는 오늘(=이미 시작)일 수 있다.
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

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
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
        // A-0 소프트삭제 이후 findByGroup 은 활성 멤버만 돌려주므로, 탈퇴(withdrawGroup)로 is_left=true 가
        // 된 행이 남아 아래 유저 삭제에서 FK 를 위반한다 — users 로 직접 훑어 소프트삭제 행까지 지운다.
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
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

    /** @return 저장된 참가 행 — 환불 멱등키의 축이라(GROMO-1258) 테스트도 id 를 알아야 한다. */
    private GroupChallengeBetParticipant participant(GroupChallengeBet bet, User user) {
        return groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
    }

    /** 서비스와 같은 기준의 오늘(KST). */
    private LocalDate today() {
        return LocalDate.now(KST);
    }

    /** 아직 시작하지 않은 회차 날짜 — DURATION 은 자정이 시작점이라 "KST 내일"이 시작 전이다. */
    private LocalDate beforeStart() {
        return today().plusDays(1);
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

    @Test
    @DisplayName("참가 ↔ 취소 동시 실행 — 행 잠금 직렬화로 '취소된 내기에 판돈이 묶이는' 상태가 없다")
    void joinAndCancelRaceNeverStrandsStake() throws Exception {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User joiner = memberUser("참가자", GroupMemberRole.MEMBER);
        // joinBet 은 "KST 오늘"만 허용한다 — 시스템 존이 아니라 서비스와 같은 KST 로 오늘을 잡는다.
        LocalDate betDate = LocalDate.now(ZoneId.of("Asia/Seoul"));
        GroupChallengeBet bet = openBet(creator, betDate);
        participant(bet, creator);
        // 참가 가드(이미 달성 차단)를 지나도록 미달성 상태를 만들어 둔다.
        focusStat(joiner, betDate, 0);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> joinCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.joinBet(group.getId(), bet.getId(), joiner.getId());
                } catch (GroupException e) {
                    // 취소가 먼저 끝났으면 BET_CLOSED 로 거절되는 것이 정상이다.
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_CLOSED);
                }
            });
            Future<?> cancelCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.cancelBet(group.getId(), bet.getId(), creator.getId());
                } catch (GroupException e) {
                    // 참가가 먼저 끝났으면 단독 조건이 깨져 거절되는 것이 정상이다.
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_CANCEL_HAS_OTHERS);
                }
            });
            joinCall.get(30, TimeUnit.SECONDS);
            cancelCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 유효한 종착지는 둘뿐이다: (a) 참가 승 — OPEN 유지, 2명, 취소 거절(환불 없음)
        // (b) 취소 승 — CANCELED, 개설자만, 참가자는 차감 자체가 없다.
        // 잠금이 없으면 "CANCELED 인데 참가자 2명·참가자 판돈 차감됨"이라는 세 번째 상태가 생긴다.
        GroupBetStatus finalStatus = statusOf(bet);
        long joinerStakes = countOf(joiner, CurrencyTransactionType.BET_STAKE);
        if (finalStatus == GroupBetStatus.OPEN) {
            assertThat(participantsOf(bet)).hasSize(2);
            assertThat(joinerStakes).isEqualTo(1);
            assertThat(countOf(creator, CurrencyTransactionType.BET_REFUND)).isZero();
            assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE - STAKE);
        } else {
            assertThat(finalStatus).isEqualTo(GroupBetStatus.CANCELED);
            assertThat(participantsOf(bet))
                    .extracting(p -> p.getUser().getId())
                    .containsExactly(creator.getId());
            assertThat(joinerStakes).isZero();
            assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE);
            assertThat(countOf(creator, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        }
    }

    // ── 그룹 탈퇴 연동 ──────────────────────────────────────────────────

    @Test
    @DisplayName("시작 전 회차 참가자 탈퇴 — 참가 행 삭제 + 본인 환불, 남은 참가자가 2명 이상이면 내기는 계속된다")
    void withdrawDetachesAndRefundsParticipant() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        // 날짜가 "오늘"에서 "KST 내일"로 바뀌었다(GROMO-1258): 탈퇴 환불은 이제 시작 전 회차 전용이고,
        // DURATION 의 당일 회차는 자정에 이미 시작된 판이라 환불 대상이 아니다(정책 §C8).
        GroupChallengeBet bet = openBet(creator, beforeStart());
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
    @DisplayName("시작 전 회차에서 참가자 탈퇴로 개설자 혼자 남으면 — 자동 취소 + 개설자도 환불된다")
    void withdrawAutoCancelsWhenCreatorLeftAlone() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, beforeStart());
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
    @DisplayName("시작 전 회차의 개설자 탈퇴 — 내기 전체 취소 + 전원 환불")
    void creatorWithdrawalCancelsBetAndRefundsEveryone() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User joinerA = memberUser("참가자A", GroupMemberRole.MEMBER);
        User joinerB = memberUser("참가자B", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator, beforeStart());
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
    @DisplayName("탈퇴자가 참가한 OPEN 내기가 여러 개면 — 시작 전 회차만 정리되고 시작된 회차는 남는다")
    void withdrawReleasesEveryOpenBet() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        // 내기 1 — 이미 시작된(전일자) 회차. GROMO-1258 이전에는 이것도 환불됐다(기대를 뒤집었다).
        GroupChallengeBet started = openBet(creator, today().minusDays(1));
        participant(started, creator);
        participant(started, leaver);
        participant(started, third);
        // 내기 2 — 시작 전(KST 내일). 탈퇴자가 빠지면 개설자 혼자라 자동 취소된다.
        GroupChallengeBet autoCanceled = openBet(creator, beforeStart());
        participant(autoCanceled, creator);
        participant(autoCanceled, leaver);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        // 시작된 회차는 참가 행·판돈이 그대로 남아 정산 대상이다(정책 §C8).
        assertThat(statusOf(started)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(participantsOf(started))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), leaver.getId(), third.getId());
        assertThat(statusOf(autoCanceled)).isEqualTo(GroupBetStatus.CANCELED);
        // 환불은 시작 전 회차 1건뿐 — 종전에는 2건(STAKE * 2)이었다.
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    @Test
    @DisplayName("시작된 회차 탈퇴 — 참가 행이 남고 환불도 없다. 이후 정산이 탈퇴자를 정상 판정한다")
    void withdrawKeepsStartedBetForSettlement() {
        // 기대 반전(GROMO-1258): 종전에는 releaseBets 에 시작 시각 가드가 없어 전일자 내기도 탈퇴로
        // 환불됐고, 그것이 "질 것 같으면 그룹을 나간다"는 우회로였다. 이제 시작된 회차는 손대지 않고
        // 정산이 그대로 판정한다 — 그룹을 나가도 계정·지갑은 살아 있으므로 지급도 정상 동작한다.
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        LocalDate betDate = today().minusDays(1);
        GroupChallengeBet bet = openBet(creator, betDate);
        participant(bet, creator);
        participant(bet, leaver);
        // 탈퇴자만 달성 — 판정이 살아 있다면 팟(60) 전액이 탈퇴자에게 간다.
        focusStat(leaver, betDate, GOAL_MINUTES);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), leaver.getId());
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isZero();
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE);
        // 그룹 탈퇴 자체는 성공한다 — 막지 않는다.
        assertThat(groupMemberRepository.findByGroup(group))
                .extracting(m -> m.getUser().getId())
                .doesNotContain(leaver.getId());

        groupBetSettler.settle(bet.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_PAYOUT)).isEqualTo(1);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("탈퇴 ↔ 정산 배치 동시 실행 — 시작된 회차는 탈퇴가 손대지 않아 정산만 돈을 움직인다")
    void withdrawAndSettleRaceMovesMoneyOnce() throws Exception {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        LocalDate betDate = today().minusDays(1);
        GroupChallengeBet bet = openBet(creator, betDate);
        participant(bet, creator);
        participant(bet, leaver);
        // 탈퇴자만 달성 — 정산이 팟(60) 전액을 탈퇴자에게 준다.
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

        // 기대 반전(GROMO-1258): 종전에는 "탈퇴가 먼저면 CANCELED + 환불" 분기가 정답이었다. 이제
        // 전일자 회차는 시작된 판이라 탈퇴 연동이 아예 건너뛰므로, 어느 순서로 들어와도 종착지는
        // 하나뿐이다 — 정산이 판정하고 지급한다. 행 잠금 직렬화 자체는 그대로 검증된다.
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_PAYOUT)).isEqualTo(1);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isZero();
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
        // 탈퇴 자체는 완료돼 있어야 한다.
        assertThat(groupMemberRepository.findByGroup(group))
                .extracting(m -> m.getUser().getId())
                .doesNotContain(leaver.getId());
    }

    @Test
    @DisplayName("철회 ↔ 그룹 탈퇴 강제 인터리빙 — 같은 참가 행의 환불은 정확히 한 번뿐이다 (E5 회귀 락)")
    void leaveAndWithdrawRaceRefundsExactlyOnce() throws Exception {
        // 이 조합의 테스트가 저장소에 아예 없어서 이중 환불이 프로덕션까지 갔다(정책 §C9).
        // 재현: ① 탈퇴가 대상 betId 를 잠금 <b>전에</b> 평문 SELECT 로 뽑고 ② 그 사이 철회가 참가 행을
        // 지우며 환불을 커밋한 뒤 ③ 탈퇴가 잠금을 얻어 "필터 0건"을 무시하고 또 환불한다.
        // 멱등키 축까지 갈려 있어(:leave-refund:{pid} vs :refund:{uid}) 원장 유니크도 무력했다.
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("철회탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        // 시작 전(KST 내일) 회차여야 철회·탈퇴 두 경로가 모두 살아 있어 인터리빙이 성립한다.
        GroupChallengeBet bet = openBet(creator, beforeStart());
        participant(bet, creator);
        participant(bet, leaver);
        participant(bet, third);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                groupMemberService.withdrawGroup(group.getId(), leaver.getId());
            });
            Future<?> leaveCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.leaveBet(group.getId(), bet.getId(), leaver.getId());
                } catch (GroupException e) {
                    // 탈퇴가 먼저 끝났으면 참가 행이 없거나(BET_NOT_JOINED) 멤버십이 빠져
                    // (MEMBER_ONLY) 거절되는 것이 정상이다.
                    assertThat(e.getErrorCode())
                            .isIn(GroupErrorCode.BET_NOT_JOINED, GroupErrorCode.MEMBER_ONLY);
                }
            });
            withdrawCall.get(30, TimeUnit.SECONDS);
            leaveCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 핵심 단언 — 어느 경로가 이겼든 환불 기입은 정확히 1건이다.
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        // 참가 행은 정확히 한 번 사라지고 나머지 2명은 그대로다 — 내기도 유지된다.
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), third.getId());
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(balanceOf(third)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}
