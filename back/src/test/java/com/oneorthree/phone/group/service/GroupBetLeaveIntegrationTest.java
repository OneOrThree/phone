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
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
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
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
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

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 내기 참가 철회(GROMO-1102) 통합 테스트 — 본인 몫만 정확히 한 번 환불되고, 마지막 참가자 철회가
 * 원자적 CANCELED 전이로 닫히는지를 실 DB 로 고정한다.
 *
 * <p>재참여 회귀 락(GROMO-1112)도 여기 있다 — "철회 → 재참여 시 참가비가 <b>실제로</b> 다시
 * 걷히는가". 다른 케이스들은 {@link #participant} 헬퍼로 참가 행을 직접 꽂지만, 그 락만은 원장이
 * 함께 도는 실제 {@code joinBet} 경로를 타야 의미가 있다(멱등키가 회차를 가르지 못하면 두 번째
 * 참가는 차감 없이 성립한다). 마지막 참가자 철회 시의 챌린지 정리(계약 §3)도 함께 고정한다.
 *
 * <p>픽스처·정리 방식은 {@link GroupBetCancelWithdrawIntegrationTest} 와 같다. 날짜 기준은 서비스와
 * 동일하게 KST 다.
 *
 * <p><b>창 시각 픽스처 주의</b>: 저장 Instant 는 현행 해석(UTC time-of-day 를 KST 벽시계로 간주)을
 * 따른다. 리터럴은 의미가 드러나도록 {@code +09:00} 오프셋 문자열로 적되, W1(KST 벽시계 해석) 머지
 * 후에는 각 리터럴의 주석을 따라 재확인이 필요하다.
 */
class GroupBetLeaveIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetService groupBetService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
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

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 30;
    /** 판돈 차감 후 잔액 — 참가 시점에 이미 STAKE 만큼 빠져 있는 상태를 재현한다. */
    private static final int BALANCE_AFTER_STAKE = 70;

    private Group group;
    /** 기본 챌린지 — FOCUS × DURATION. 창형이 필요한 테스트는 {@link #windowChallenge} 로 추가한다. */
    private GroupChallenge challenge;
    private User owner;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallenge> extraChallenges = new ArrayList<>();
    private final List<GroupChallengeBet> bets = new ArrayList<>();

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
        extraChallenges.forEach(c -> groupChallengeWindowRepository.findById(c.getId())
                .ifPresent(groupChallengeWindowRepository::delete));
        groupChallengeRepository.deleteAll(extraChallenges);
        groupChallengeDurationRepository.findById(challenge.getId())
                .ifPresent(groupChallengeDurationRepository::delete);
        groupChallengeRepository.delete(challenge);
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        extraChallenges.clear();
        bets.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User memberUser(String nickname, GroupMemberRole role) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        groupMemberRepository.save(GroupMember.builder().user(user).group(group).role(role).build());
        users.add(user);
        return user;
    }

    /** 창형(FOCUS × TIME_WINDOW) 챌린지 — 창 시각은 KST 벽시계 time 이다(V32). */
    private GroupChallenge windowChallenge(LocalTime windowStart, LocalTime windowEnd) {
        GroupChallenge windowed = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.TIME_WINDOW)
                .build());
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(windowed)
                .windowStart(windowStart)
                .windowEnd(windowEnd)
                .durationMinutes(GOAL_MINUTES)
                .build());
        extraChallenges.add(windowed);
        return windowed;
    }

    private GroupChallengeBet openBetOn(GroupChallenge target, User creator, LocalDate betDate) {
        return betOn(target, creator, betDate, GroupBetStatus.OPEN);
    }

    private GroupChallengeBet betOn(
            GroupChallenge target, User creator, LocalDate betDate, GroupBetStatus status) {
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(target)
                .creatorUser(creator)
                .stake(STAKE)
                .betDate(betDate)
                .status(status)
                .build());
        bets.add(bet);
        return bet;
    }

    private void participant(GroupChallengeBet bet, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private long refundCountOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_REFUND)
                .count();
    }

    /** 참가비 차감 기입의 멱등키 — 회차마다 값이 달라야 재참여가 실제 차감으로 이어진다. */
    private List<String> stakeKeysOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_STAKE)
                .map(CurrencyTransaction::getIdempotencyKey)
                .toList();
    }

    private Instant deletedAtOf(GroupChallenge target) {
        return groupChallengeRepository.findById(target.getId()).orElseThrow().getDeletedAt();
    }

    private GroupBetStatus statusOf(GroupChallengeBet bet) {
        return groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getStatus();
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBet bet) {
        return groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId()));
    }

    private LocalDate today() {
        return LocalDate.now(KST);
    }

    // ── 철회 허용 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("내일 내기 참가자 철회 — 본인 행 삭제 + 본인만 환불, 남은 2명으로 내기 유지")
    void leaveRefundsOnlyLeaverAndKeepsBetOpen() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("철회자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(challenge, creator, today().plusDays(1));
        participant(bet, creator);
        participant(bet, leaver);
        participant(bet, third);

        groupBetService.leaveBet(group.getId(), bet.getId(), leaver.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(leaver)).isEqualTo(1);
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), third.getId());
        // 잔류 참가자에게는 아무 일도 없다.
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(balanceOf(third)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("개설자 철회 — 남은 참가자가 있으면 내기 유지, 이후 개설자의 구버전 cancelBet 은 안전하게 거절")
    void creatorLeaveKeepsBetAndOrphanedCancelIsRejected() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User joiner = memberUser("참가자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(challenge, creator, today().plusDays(1));
        participant(bet, creator);
        participant(bet, joiner);

        groupBetService.leaveBet(group.getId(), bet.getId(), creator.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(creator)).isEqualTo(1);
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId())
                .containsExactly(joiner.getId());

        // 개설자는 빠졌지만 creatorUserId 는 이력으로 남는다 — 그 상태로 구버전 취소가 오면
        // "타 참가자 존재" 검사에 걸려 이중 환불 없이 거절된다(고아 cancelBet 안전성).
        assertThatThrownBy(() -> groupBetService.cancelBet(group.getId(), bet.getId(), creator.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        assertThat(refundCountOf(creator)).isEqualTo(1);
    }

    @Test
    @DisplayName("마지막 참가자 철회 — CANCELED 자동 전이 + 환불, 재철회는 BET_NOT_JOINED 로 거절(환불 1회)")
    void lastParticipantLeaveCancelsBetIdempotently() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(challenge, creator, today().plusDays(1));
        participant(bet, creator);

        groupBetService.leaveBet(group.getId(), bet.getId(), creator.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.CANCELED);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(creator)).isEqualTo(1);
        assertThat(participantsOf(bet)).isEmpty();

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), bet.getId(), creator.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_JOINED);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(creator)).isEqualTo(1);
    }

    @Test
    @DisplayName("창형 내일 내기 — 창 시작 전이므로 철회 허용")
    void windowBetTomorrowCanBeLeft() {
        // KST 18:00~20:00 창 — 내일 창의 시작은 항상 미래다.
        GroupChallenge windowed = windowChallenge(LocalTime.of(18, 0), LocalTime.of(20, 0));
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("철회자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(windowed, creator, today().plusDays(1));
        participant(bet, creator);
        participant(bet, leaver);

        groupBetService.leaveBet(group.getId(), bet.getId(), leaver.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(leaver)).isEqualTo(1);
    }

    // ── 재참여 회귀 락 (GROMO-1112) ─────────────────────────────────────

    @Test
    @DisplayName("철회 → 재참여 — 참가비가 실제로 다시 차감된다(차감 2건·환불 1건, 멱등키는 회차마다 다름)")
    void rejoinAfterLeaveChargesStakeAgain() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        // 이 유저는 아직 참가 전이라 BALANCE_AFTER_STAKE 는 그냥 시작 잔액이다 — 차감은 joinBet 이 한다.
        User joiner = memberUser("재참여자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(challenge, creator, today().plusDays(1));
        // 개설자 참가 행은 직접 꽂는다 — 재참여자가 빠져도 내기가 유지되도록 하는 픽스처일 뿐이다.
        participant(bet, creator);

        groupBetService.joinBet(group.getId(), bet.getId(), joiner.getId());
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE - STAKE);

        groupBetService.leaveBet(group.getId(), bet.getId(), joiner.getId());
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE);

        groupBetService.joinBet(group.getId(), bet.getId(), joiner.getId());

        // 핵심 단언 — 재참여가 무상이면 여기서 잔액이 원금 그대로 남는다(참가비 0원 참가).
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE - STAKE);
        assertThat(stakeKeysOf(joiner)).hasSize(2).doesNotHaveDuplicates();
        // 축이 유저였다면 두 키가 같아져 두 번째 차감이 조용히 스킵된다.
        assertThat(stakeKeysOf(joiner))
                .noneMatch(key -> key.equals("bet:" + bet.getId() + ":stake:" + joiner.getId()));
        assertThat(refundCountOf(joiner)).isEqualTo(1);
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(participantsOf(bet))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), joiner.getId());
    }

    // ── 마지막 참가자 철회 → 챌린지는 건드리지 않는다 ─────────────────────

    @Test
    @DisplayName("마지막 참가자가 철회해도 챌린지는 그대로 남는다 — 내기만 취소된다")
    void lastParticipantLeaveKeepsChallenge() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(challenge, creator, today().plusDays(1));
        participant(bet, creator);

        groupBetService.leaveBet(group.getId(), bet.getId(), creator.getId());

        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.CANCELED);
        // 챌린지는 여러 날짜에 걸쳐 재사용되는 미션 템플릿이라, 하루치 판이 비었다고 해서
        // 참가자 한 명의 철회로 그룹 공용 자산을 지우지 않는다. 빈 챌린지를 어떻게 다룰지는
        // 별도 티켓에서 설계한다 — 이 단언은 그 결정 없이 삭제가 슬쩍 들어오는 것을 막는다.
        assertThat(deletedAtOf(challenge)).isNull();
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(creator)).isEqualTo(1);
    }

    // ── 철회 거절 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("DURATION 당일 내기 → BET_LEAVE_CLOSED — 집계가 진행 중이라 무를 수 없다")
    void sameDayDurationBetCannotBeLeft() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(challenge, creator, today());
        participant(bet, creator);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), bet.getId(), creator.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(creator)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(refundCountOf(creator)).isZero();
        assertThat(participantsOf(bet)).hasSize(1);
    }

    @Test
    @DisplayName("창형 전일자 내기(배치 전 OPEN 잔존) → 창이 이미 시작돼 BET_LEAVE_CLOSED")
    void startedWindowBetOfPreviousDateCannotBeLeft() {
        // KST 07:00~10:00 창 — 전일자 내기의 창 시작은 이미 과거다.
        GroupChallenge windowed = windowChallenge(LocalTime.of(7, 0), LocalTime.of(10, 0));
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(windowed, creator, today().minusDays(1));
        participant(bet, creator);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), bet.getId(), creator.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(refundCountOf(creator)).isZero();
    }

    @Test
    @DisplayName("정산이 끝난 내기(SETTLED) → BET_NOT_OPEN — 정산 결과를 철회로 무를 수 없다")
    void settledBetCannotBeLeft() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = betOn(challenge, creator, today().minusDays(1), GroupBetStatus.SETTLED);
        participant(bet, creator);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), bet.getId(), creator.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertThat(refundCountOf(creator)).isZero();
        assertThat(participantsOf(bet)).hasSize(1);
    }

    @Test
    @DisplayName("미참가 그룹원의 철회 → BET_NOT_JOINED, 아무 변화 없음")
    void nonParticipantCannotLeave() {
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User outsider = memberUser("미참가자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBetOn(challenge, creator, today().plusDays(1));
        participant(bet, creator);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), bet.getId(), outsider.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_JOINED);
        assertThat(statusOf(bet)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(outsider)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(refundCountOf(outsider)).isZero();
        assertThat(participantsOf(bet)).hasSize(1);
    }
}
