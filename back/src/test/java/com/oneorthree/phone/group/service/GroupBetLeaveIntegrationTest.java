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
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
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
 * 내기 참가 철회(GROMO-1102) 통합 테스트 — 2계층 재편(GROMO-1262) 기준. 본인 몫만 정확히 한 번
 * 환불되고, 마지막 참가자 철회가 회차 행 삭제("없던 일")로 닫히는지를 실 DB 로 고정한다.
 *
 * <p>재참여 회귀 락(GROMO-1112)도 여기 있다 — "철회 → 재참여 시 참가비가 <b>실제로</b> 다시
 * 걷히는가". 멱등키 축이 참가 행 id(FR-42)라 회차·참가마다 키가 갈린다.
 *
 * <p>픽스처·정리 방식은 {@link GroupBetCancelWithdrawIntegrationTest} 와 같다. 날짜 기준은 서비스와
 * 동일하게 KST 다.
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
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
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
    /** 참가비 차감 후 잔액 — 참가 시점에 이미 STAKE 만큼 빠져 있는 상태를 재현한다. */
    private static final int BALANCE_AFTER_STAKE = 70;

    private Group group;
    /** 기본 챌린지 — FOCUS × DURATION. 창형이 필요한 테스트는 {@link #windowChallenge} 로 추가한다. */
    private GroupChallenge challenge;
    private User owner;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallenge> extraChallenges = new ArrayList<>();
    private final List<GroupChallengeBet> configs = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(challenge).category(MissionCategory.FOCUS).durationMinutes(GOAL_MINUTES).build());
        owner = memberUser("방장", GroupMemberRole.OWNER);
    }

    @AfterEach
    void tearDown() {
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        betSessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        // 마지막 참가자 철회는 회차 행을 지운다 — 이미 없는 행은 existsById 로 걸러 지운다.
        betSessions.forEach(s -> {
            if (groupChallengeBetSessionRepository.existsById(s.getId())) {
                groupChallengeBetSessionRepository.deleteById(s.getId());
            }
        });
        groupChallengeBetRepository.deleteAll(configs);
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
        configs.clear();
        betSessions.clear();
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

    /** 창형(FOCUS × TIME_WINDOW) 챌린지 — 창 시각은 KST 벽시계 time 그대로(V35). */
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

    private GroupChallengeBet configOf(GroupChallenge target) {
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(target).stake(STAKE).enabled(true).build());
        configs.add(config);
        return config;
    }

    /** 하루형 회차 — 시작 = 회차일 00:00 KST. */
    private GroupChallengeBetSession sessionOn(
            GroupChallenge target, LocalDate sessionDate, GroupBetStatus status) {
        return saveSession(target, sessionDate, status, null, null,
                sessionDate.atStartOfDay(KST).toInstant(),
                sessionDate.plusDays(1).atStartOfDay(KST).toInstant());
    }

    /** 창형 회차 — 시작·종료가 창 시각(박제 스냅샷)이다. */
    private GroupChallengeBetSession windowSessionOn(
            GroupChallenge target, LocalDate sessionDate, LocalTime windowStart, LocalTime windowEnd) {
        LocalDate endDate = windowStart.isBefore(windowEnd) ? sessionDate : sessionDate.plusDays(1);
        return saveSession(target, sessionDate, GroupBetStatus.OPEN, windowStart, windowEnd,
                sessionDate.atTime(windowStart).atZone(KST).toInstant(),
                endDate.atTime(windowEnd).atZone(KST).toInstant());
    }

    private GroupChallengeBetSession saveSession(GroupChallenge target, LocalDate sessionDate,
            GroupBetStatus status, LocalTime windowStart, LocalTime windowEnd,
            Instant startsAt, Instant closesAt) {
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(configOf(target))
                        .group(group)
                        .challenge(target)
                        .sessionDate(sessionDate)
                        .stake(STAKE)
                        .goalMinutes(GOAL_MINUTES)
                        .missionCategory(target.getCategory())
                        .missionType(target.getType())
                        .windowStart(windowStart)
                        .windowEnd(windowEnd)
                        .status(status)
                        .startsAt(startsAt)
                        .joinClosesAt(closesAt)
                        .closesAt(closesAt)
                        .settleAfter(closesAt)
                        .build());
        betSessions.add(session);
        return session;
    }

    private void participant(GroupChallengeBetSession session, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private long refundCountOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_REFUND)
                .count();
    }

    /** 참가비 차감 기입의 멱등키 — 참가 행마다 값이 달라야 재참여가 실제 차감으로 이어진다. */
    private List<String> stakeKeysOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_STAKE)
                .map(CurrencyTransaction::getIdempotencyKey)
                .toList();
    }

    private Instant deletedAtOf(GroupChallenge target) {
        return groupChallengeRepository.findById(target.getId()).orElseThrow().getDeletedAt();
    }

    private GroupBetStatus statusOf(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow().getStatus();
    }

    private boolean sessionExists(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.existsById(session.getId());
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBetSession session) {
        return groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(session.getId()));
    }

    private LocalDate today() {
        return LocalDate.now(KST);
    }

    // ── 철회 허용 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("내일 회차 참가자 철회 — 본인 행 삭제 + 본인만 환불, 남은 2명으로 회차 유지")
    void leaveRefundsOnlyLeaverAndKeepsSessionOpen() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("철회자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = sessionOn(challenge, today().plusDays(1), GroupBetStatus.OPEN);
        participant(session, opener);
        participant(session, leaver);
        participant(session, third);

        groupBetService.leaveBet(group.getId(), session.getId(), leaver.getId());

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(leaver)).isEqualTo(1);
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(opener.getId(), third.getId());
        // 잔류 참가자에게는 아무 일도 없다.
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(balanceOf(third)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("개설자 철회 — 남은 참가자가 있으면 회차 유지, 이후 개설자의 구버전 cancelBet 은 안전하게 거절")
    void openerLeaveKeepsSessionAndOrphanedCancelIsRejected() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User joiner = memberUser("참가자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = sessionOn(challenge, today().plusDays(1), GroupBetStatus.OPEN);
        participant(session, opener);
        participant(session, joiner);

        groupBetService.leaveBet(group.getId(), session.getId(), opener.getId());

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(opener)).isEqualTo(1);
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId())
                .containsExactly(joiner.getId());

        // 이미 빠진 사람의 구버전 취소 — 참가자 검사에 걸려 이중 환불 없이 거절된다(재편 후에는
        // "내 참가 행 없음" = BET_CANCEL_FORBIDDEN — 개설자 개념 소멸).
        assertThatThrownBy(() -> groupBetService.cancelBet(group.getId(), session.getId(), opener.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_FORBIDDEN);
        assertThat(refundCountOf(opener)).isEqualTo(1);
    }

    @Test
    @DisplayName("마지막 참가자 철회 — 회차 행 삭제('없던 일') + 환불, 재철회는 BET_NOT_FOUND 로 거절(환불 1회)")
    void lastParticipantLeaveDeletesSessionIdempotently() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = sessionOn(challenge, today().plusDays(1), GroupBetStatus.OPEN);
        participant(session, opener);

        groupBetService.leaveBet(group.getId(), session.getId(), opener.getId());

        // 회차 행 자체가 사라진다 — 같은 날짜 재개설이 UNIQUE (bet_id, session_date)에 막히지 않는다.
        assertThat(sessionExists(session)).isFalse();
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(opener)).isEqualTo(1);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), session.getId(), opener.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(opener)).isEqualTo(1);
    }

    @Test
    @DisplayName("창형 내일 회차 — 창 시작 전이므로 철회 허용")
    void windowSessionTomorrowCanBeLeft() {
        // KST 18:00~20:00 창 — 내일 창의 시작은 항상 미래라 철회가 열려 있다.
        GroupChallenge windowed = windowChallenge(LocalTime.of(18, 0), LocalTime.of(20, 0));
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("철회자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = windowSessionOn(
                windowed, today().plusDays(1), LocalTime.of(18, 0), LocalTime.of(20, 0));
        participant(session, opener);
        participant(session, leaver);

        groupBetService.leaveBet(group.getId(), session.getId(), leaver.getId());

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(leaver)).isEqualTo(1);
    }

    // ── 재참여 회귀 락 (GROMO-1112 · FR-42) ─────────────────────────────

    @Test
    @DisplayName("철회 → 재참여 — 참가비가 실제로 다시 차감된다(차감 2건·환불 1건, 멱등키는 참가 행마다 다름)")
    void rejoinAfterLeaveChargesStakeAgain() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        // 이 유저는 아직 참가 전이라 BALANCE_AFTER_STAKE 는 그냥 시작 잔액이다 — 차감은 joinBet 이 한다.
        User joiner = memberUser("재참여자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = sessionOn(challenge, today().plusDays(1), GroupBetStatus.OPEN);
        // 개설자 참가 행은 직접 꽂는다 — 재참여자가 빠져도 회차가 유지되도록 하는 픽스처일 뿐이다.
        participant(session, opener);

        groupBetService.joinBet(group.getId(), session.getId(), joiner.getId());
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE - STAKE);

        groupBetService.leaveBet(group.getId(), session.getId(), joiner.getId());
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE);

        groupBetService.joinBet(group.getId(), session.getId(), joiner.getId());

        // 핵심 단언 — 재참여가 무상이면 여기서 잔액이 원금 그대로 남는다(참가비 0원 참가).
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE - STAKE);
        assertThat(stakeKeysOf(joiner)).hasSize(2).doesNotHaveDuplicates();
        // 축이 유저였다면 두 키가 같아져 두 번째 차감이 조용히 스킵된다(FR-42 의 존재 이유).
        assertThat(stakeKeysOf(joiner))
                .noneMatch(key -> key.equals("session:" + session.getId() + ":stake:" + joiner.getId()));
        assertThat(refundCountOf(joiner)).isEqualTo(1);
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(opener.getId(), joiner.getId());
    }

    // ── 마지막 참가자 철회 → 챌린지는 건드리지 않는다 ─────────────────────

    @Test
    @DisplayName("마지막 참가자가 철회해도 챌린지·설정은 그대로 남는다 — 회차만 사라진다")
    void lastParticipantLeaveKeepsChallengeAndConfig() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = sessionOn(challenge, today().plusDays(1), GroupBetStatus.OPEN);
        participant(session, opener);

        groupBetService.leaveBet(group.getId(), session.getId(), opener.getId());

        assertThat(sessionExists(session)).isFalse();
        // 챌린지는 여러 날짜에 걸쳐 재사용되는 미션 템플릿이라, 하루치 판이 비었다고 지우지 않는다.
        assertThat(deletedAtOf(challenge)).isNull();
        // 설정도 남는다 — "내기 걸린 적 있음"(휴면 배지)의 근거다.
        assertThat(groupChallengeBetRepository.findByChallengeId(challenge.getId())).isPresent();
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(refundCountOf(opener)).isEqualTo(1);
    }

    // ── 철회 거절 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("하루형 당일 회차 → BET_LEAVE_CLOSED — 시작(00:00 KST)이 이미 지나 무를 수 없다")
    void sameDayDurationSessionCannotBeLeft() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = sessionOn(challenge, today(), GroupBetStatus.OPEN);
        participant(session, opener);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), session.getId(), opener.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(refundCountOf(opener)).isZero();
        assertThat(participantsOf(session)).hasSize(1);
    }

    @Test
    @DisplayName("전일자 창형 회차(배치 전 OPEN 잔존) → 창이 이미 시작돼 BET_LEAVE_CLOSED")
    void startedYesterdayWindowSessionCannotBeLeft() {
        // KST 07:00~10:00 창 — 전일자 회차의 창 시작은 언제나 과거라 철회가 닫혀 있다.
        GroupChallenge windowed = windowChallenge(LocalTime.of(7, 0), LocalTime.of(10, 0));
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = windowSessionOn(
                windowed, today().minusDays(1), LocalTime.of(7, 0), LocalTime.of(10, 0));
        participant(session, opener);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), session.getId(), opener.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(refundCountOf(opener)).isZero();
    }

    @Test
    @DisplayName("정산이 끝난 회차(SETTLED) → BET_NOT_OPEN — 정산 결과를 철회로 무를 수 없다")
    void settledSessionCannotBeLeft() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session =
                sessionOn(challenge, today().minusDays(1), GroupBetStatus.SETTLED);
        participant(session, opener);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), session.getId(), opener.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_OPEN);
        assertThat(refundCountOf(opener)).isZero();
        assertThat(participantsOf(session)).hasSize(1);
    }

    @Test
    @DisplayName("미참가 그룹원의 철회 → BET_NOT_JOINED, 아무 변화 없음")
    void nonParticipantCannotLeave() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User outsider = memberUser("미참가자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = sessionOn(challenge, today().plusDays(1), GroupBetStatus.OPEN);
        participant(session, opener);

        assertThatThrownBy(() -> groupBetService.leaveBet(group.getId(), session.getId(), outsider.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_JOINED);
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(outsider)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(refundCountOf(outsider)).isZero();
        assertThat(participantsOf(session)).hasSize(1);
    }
}
