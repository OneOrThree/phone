package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
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
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 내기 취소·그룹 탈퇴 연동 통합 테스트 — 2계층 재편(GROMO-1262) 기준. 환불이 <b>정확히 한 번</b>,
 * 그리고 정산 배치·철회·탈퇴가 겹쳐도 돈이 한 경로로만 움직이는지를 실 DB 로 고정한다.
 *
 * <p>1258 P0 3종(이중 환불 TOCTOU · 탈퇴 우회 · 멱등키 분열)의 재발 방지가 이 파일의 존재
 * 이유다 — 환불 멱등키가 참가 행 id 단일 축(FR-42)이라 취소 × 탈퇴 교차 경로도 원장 UNIQUE 가
 * 최후 방어하고, 잠금 후 참가 행 재조회가 1차 방어다. 강제 인터리빙 테스트가 아래에 있다.
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

    private Group group;
    private GroupChallenge challenge;
    private GroupChallengeBet config;
    /** 방장 — 탈퇴 시나리오에서 그룹을 지키는 별도 인물(내기에는 참가하지 않는다). */
    private User owner;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();
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
        config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).stake(STAKE).enabled(true).build());
        owner = memberUser("방장", GroupMemberRole.OWNER);
    }

    @AfterEach
    void tearDown() {
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        betSessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        betSessions.forEach(s -> {
            if (groupChallengeBetSessionRepository.existsById(s.getId())) {
                groupChallengeBetSessionRepository.deleteById(s.getId());
            }
        });
        groupChallengeBetRepository.delete(config);
        dailyFocusStatRepository.deleteAll(stats);
        groupChallengeDurationRepository.findById(challenge.getId())
                .ifPresent(groupChallengeDurationRepository::delete);
        groupChallengeRepository.delete(challenge);
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        betSessions.clear();
        stats.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    /** 그룹 멤버십까지 갖춘, 참가비를 이미 낸(잔액 70) 유저. */
    private User memberUser(String nickname, GroupMemberRole role) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        groupMemberRepository.save(GroupMember.builder().user(user).group(group).role(role).build());
        users.add(user);
        return user;
    }

    private GroupChallengeBetSession openSession(LocalDate sessionDate) {
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config)
                        .group(group)
                        .challenge(challenge)
                        .sessionDate(sessionDate)
                        .stake(STAKE)
                        .goalMinutes(GOAL_MINUTES)
                        .missionCategory(MissionCategory.FOCUS)
                        .missionType(MissionType.DURATION)
                        .status(GroupBetStatus.OPEN)
                        .startsAt(sessionDate.atStartOfDay(KST).toInstant())
                        .joinClosesAt(sessionDate.plusDays(1).atStartOfDay(KST).toInstant())
                        .closesAt(sessionDate.plusDays(1).atStartOfDay(KST).toInstant())
                        .settleAfter(sessionDate.plusDays(1).atStartOfDay(KST).toInstant())
                        .build());
        betSessions.add(session);
        return session;
    }

    private void participant(GroupChallengeBetSession session, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
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

    private GroupBetStatus statusOf(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow().getStatus();
    }

    private boolean sessionExists(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.existsById(session.getId());
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBetSession session) {
        return groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(session.getId()));
    }

    // ── 취소 ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("취소 성공 — 참가 삭제 + 환불 + 회차 행 삭제('없던 일')가 지갑·원장에 정확히 한 번 반영된다")
    void cancelRefundsSoleParticipantOnceAndDeletesSession() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = openSession(LocalDate.now(KST));
        participant(session, opener);

        groupBetService.cancelBet(group.getId(), session.getId(), opener.getId());

        assertThat(sessionExists(session)).isFalse();
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(opener, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(participantsOf(session)).isEmpty();
    }

    @Test
    @DisplayName("이중 취소 — 두 번째 호출은 BET_NOT_FOUND(회차가 이미 '없던 일')로 거절되고 환불은 한 번뿐이다")
    void doubleCancelRefundsOnlyOnce() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = openSession(LocalDate.now(KST));
        participant(session, opener);

        groupBetService.cancelBet(group.getId(), session.getId(), opener.getId());

        assertThatThrownBy(() -> groupBetService.cancelBet(group.getId(), session.getId(), opener.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(opener, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
    }

    @Test
    @DisplayName("타인이 참가한 뒤에는 취소할 수 없다 — BET_CANCEL_HAS_OTHERS, 환불 없음")
    void cancelRejectedAfterOthersJoin() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User joiner = memberUser("참가자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = openSession(LocalDate.now(KST));
        participant(session, opener);
        participant(session, joiner);

        assertThatThrownBy(() -> groupBetService.cancelBet(group.getId(), session.getId(), opener.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(countOf(opener, CurrencyTransactionType.BET_REFUND)).isZero();
    }

    @Test
    @DisplayName("취소 ↔ 정산 배치 동시 실행 — 회차 잠금·원장 유니크로 한 경로만 돈을 움직인다")
    void cancelAndSettleRaceMovesMoneyOnce() throws Exception {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        LocalDate sessionDate = LocalDate.now(KST).minusDays(1);
        GroupChallengeBetSession session = openSession(sessionDate);
        participant(session, opener);
        // 달성 상태 — 정산이 이기면 팟(=본인 참가비) 전액이 지급된다.
        focusStat(opener, sessionDate, GOAL_MINUTES);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> cancelCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.cancelBet(group.getId(), session.getId(), opener.getId());
                } catch (GroupException e) {
                    // 정산이 먼저 끝났으면 BET_NOT_OPEN 으로 거절되는 것이 정상이다.
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_NOT_OPEN);
                }
            });
            Future<?> settleCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetSettler.settle(session.getId());
                } catch (GroupException e) {
                    // 취소가 먼저 끝나 회차가 "없던 일"로 삭제됐으면 정산은 대상 없음으로 거절된다.
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_NOT_FOUND);
                }
            });
            cancelCall.get(30, TimeUnit.SECONDS);
            settleCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 어느 쪽이 이겼든 "정확히 한 번, 한 종류"의 지급만 존재한다. 단독 참가라 금액은 어느
        // 경로든 STAKE 그대로다 — 잔액으로 이중 지급 여부를 최종 확인한다.
        long refunds = countOf(opener, CurrencyTransactionType.BET_REFUND);
        long payouts = countOf(opener, CurrencyTransactionType.BET_PAYOUT);
        assertThat(refunds + payouts).isEqualTo(1);
        if (sessionExists(session)) {
            assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
            assertThat(payouts).isEqualTo(1);
        } else {
            assertThat(refunds).isEqualTo(1);
        }
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    @Test
    @DisplayName("참가 ↔ 취소 동시 실행 — 행 잠금 직렬화로 '사라진 회차에 참가비가 묶이는' 상태가 없다")
    void joinAndCancelRaceNeverStrandsStake() throws Exception {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User joiner = memberUser("참가자", GroupMemberRole.MEMBER);
        LocalDate sessionDate = LocalDate.now(KST);
        GroupChallengeBetSession session = openSession(sessionDate);
        participant(session, opener);
        // 참가 가드(이미 달성 차단)를 지나도록 미달성 상태를 만들어 둔다.
        focusStat(joiner, sessionDate, 0);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> joinCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.joinBet(group.getId(), session.getId(), joiner.getId());
                } catch (GroupException e) {
                    // 취소가 먼저 끝나 회차가 삭제됐으면 BET_NOT_FOUND 로 거절되는 것이 정상이다.
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_NOT_FOUND);
                }
            });
            Future<?> cancelCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.cancelBet(group.getId(), session.getId(), opener.getId());
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

        // 유효한 종착지는 둘뿐이다: (a) 참가 승 — 회차 유지, 2명, 취소 거절(환불 없음)
        // (b) 취소 승 — 회차 삭제, 참가자는 차감 자체가 없다.
        // 잠금이 없으면 "삭제됐는데 참가자 판돈 차감됨"이라는 세 번째 상태가 생긴다.
        long joinerStakes = countOf(joiner, CurrencyTransactionType.BET_STAKE);
        if (sessionExists(session)) {
            assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
            assertThat(participantsOf(session)).hasSize(2);
            assertThat(joinerStakes).isEqualTo(1);
            assertThat(countOf(opener, CurrencyTransactionType.BET_REFUND)).isZero();
            assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE - STAKE);
        } else {
            assertThat(joinerStakes).isZero();
            assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE);
            assertThat(countOf(opener, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        }
    }

    // ── 그룹 탈퇴 연동 ──────────────────────────────────────────────────

    @Test
    @DisplayName("참가자 탈퇴 — 참가 행 삭제 + 본인 환불, 남은 참가자가 있으면 회차는 계속된다")
    void withdrawDetachesAndRefundsParticipant() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = openSession(LocalDate.now(KST));
        participant(session, opener);
        participant(session, leaver);
        participant(session, third);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(opener.getId(), third.getId());
        // 잔류 참가자에게는 아무 일도 없다.
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(balanceOf(third)).isEqualTo(BALANCE_AFTER_STAKE);
        // 그룹 멤버십도 실제로 빠졌다.
        assertThat(groupMemberRepository.findByGroup(group))
                .extracting(m -> m.getUser().getId())
                .doesNotContain(leaver.getId());
    }

    @Test
    @DisplayName("참가자 탈퇴로 1명 남아도 회차는 유지된다 — 자동 취소 없음(재편: 인원 미달 무산은 참가 마감 크론 B4·N47)")
    void withdrawKeepsSessionWhenOneParticipantRemains() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = openSession(LocalDate.now(KST));
        participant(session, opener);
        participant(session, leaver);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        // 잔류자는 환불되지 않는다 — 인원 미달 무산(VOIDED + 환불) 판정은 참가 마감 시점의 몫이다.
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(countOf(opener, CurrencyTransactionType.BET_REFUND)).isZero();
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId())
                .containsExactly(opener.getId());
    }

    @Test
    @DisplayName("마지막 참가자 탈퇴 — 본인 환불 + 회차 행 삭제('없던 일')")
    void withdrawDeletesSessionWhenLastParticipantLeaves() {
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession session = openSession(LocalDate.now(KST));
        participant(session, leaver);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(sessionExists(session)).isFalse();
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
    }

    @Test
    @DisplayName("탈퇴 정리도 취소 마감 규칙(N22·FR-40) — 마감 지난 회차는 정산 잔류, 취소 가능한 회차만 환불")
    void withdrawReleasesEveryOpenSession() {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        // 회차 1 — 전일자(배치 전 OPEN 잔존). 회차 종료가 지나 취소 마감도 지났다 — 탈퇴해도 참가·
        // 에스크로가 정산 대상으로 남는다(FR-40 "시작된 회차는 정산 대상 잔류", GROMO-1423).
        GroupChallengeBetSession continuing = openSession(LocalDate.now(KST).minusDays(1));
        participant(continuing, opener);
        participant(continuing, leaver);
        participant(continuing, third);
        // 회차 2 — 오늘 회차에 방금 참가(유예 안). 환불되고, 탈퇴자뿐이라 비면서 "없던 일"로 삭제된다.
        GroupChallengeBetSession emptied = openSession(LocalDate.now(KST));
        participant(emptied, leaver);

        groupMemberService.withdrawGroup(group.getId(), leaver.getId());

        assertThat(statusOf(continuing)).isEqualTo(GroupBetStatus.OPEN);
        // 전일자 회차의 참가 행은 그대로다 — 정산이 판정하고, 명단엔 "탈퇴한 사용자"로 실린다.
        assertThat(participantsOf(continuing)).hasSize(3);
        assertThat(sessionExists(emptied)).isFalse();
        // 환불은 취소 가능(유예 안)이었던 오늘 회차 몫 정확히 1회뿐이다(FR-41·FR-42).
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    // ── 강제 인터리빙 (1258 P0 재발 방지) ────────────────────────────────

    @Test
    @DisplayName("철회 ↔ 그룹 탈퇴 동시 실행 — 잠금 후 재조회 + 단일 환불 키로 환불은 정확히 한 번 (구 E5)")
    void leaveAndWithdrawRaceRefundsExactlyOnce() throws Exception {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        // 철회 가드(시작 전)를 지나도록 내일 회차로 둔다 — 탈퇴 연동은 시작 여부와 무관하다.
        GroupChallengeBetSession session = openSession(LocalDate.now(KST).plusDays(1));
        participant(session, opener);
        participant(session, leaver);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> leaveCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.leaveBet(group.getId(), session.getId(), leaver.getId());
                } catch (GroupException e) {
                    // 탈퇴가 먼저 끝났으면 참가 행이 이미 없다(BET_NOT_JOINED) —
                    // 멤버십이 먼저 정리됐으면 MEMBER_ONLY 로도 떨어질 수 있다.
                    assertThat(e.getErrorCode()).isIn(
                            GroupErrorCode.BET_NOT_JOINED, GroupErrorCode.MEMBER_ONLY);
                }
            });
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                groupMemberService.withdrawGroup(group.getId(), leaver.getId());
            });
            leaveCall.get(30, TimeUnit.SECONDS);
            withdrawCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 핵심 불변식 — 어느 인터리빙이든 환불은 정확히 1건이다. 잠금 후 재조회(1차 방어)가
        // 뚫려도 환불 키가 참가 행 단일 축(session:{sid}:refund:{pid}, FR-42)이라 원장 UNIQUE 가
        // 두 번째 기입을 막는다(구 E5: 취소 × 탈퇴 이중 환불의 재발 방지).
        assertThat(countOf(leaver, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        // 탈퇴자의 참가 행은 사라졌고, 잔류자는 무변동이다.
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId())
                .containsExactly(opener.getId());
        assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(countOf(opener, CurrencyTransactionType.BET_REFUND)).isZero();
    }

    @Test
    @DisplayName("참가 ↔ 그룹 탈퇴 동시 실행 — 멤버십 잠금 직렬화로 '그룹에 없는 사람의 유료 참가'가 남지 않는다 (N54)")
    void joinAndWithdrawRaceNeverLeavesPaidGhostParticipation() throws Exception {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User joiner = memberUser("참가탈퇴자", GroupMemberRole.MEMBER);
        LocalDate sessionDate = LocalDate.now(KST);
        GroupChallengeBetSession session = openSession(sessionDate);
        participant(session, opener);
        focusStat(joiner, sessionDate, 0);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> joinCall = pool.submit(() -> {
                await(startTogether);
                try {
                    groupBetService.joinBet(group.getId(), session.getId(), joiner.getId());
                } catch (GroupException e) {
                    // 탈퇴가 먼저 커밋됐으면 활성 멤버십 재검증(N54)이 거절한다.
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY);
                }
            });
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                groupMemberService.withdrawGroup(group.getId(), joiner.getId());
            });
            joinCall.get(30, TimeUnit.SECONDS);
            withdrawCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 핵심 불변식 — "탈퇴 완료 + 참가 행 잔존 + 참가비 차감"이라는 유령 상태가 없다:
        // ① 참가가 먼저면 탈퇴의 회차 정리가 그 참가까지 보고 환불한다(멤버십 배타 잠금 선점).
        // ② 탈퇴가 먼저면 참가의 멤버십 공유 잠금 재검증이 거절해 차감 자체가 없다.
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId())
                .containsExactly(opener.getId());
        long stakes = countOf(joiner, CurrencyTransactionType.BET_STAKE);
        long refunds = countOf(joiner, CurrencyTransactionType.BET_REFUND);
        assertThat(stakes).isEqualTo(refunds);   // 차감됐다면 반드시 환불도 됐다
        assertThat(balanceOf(joiner)).isEqualTo(BALANCE_AFTER_STAKE);
        // 탈퇴 자체는 완료돼 있다.
        assertThat(groupMemberRepository.findByGroup(group))
                .extracting(m -> m.getUser().getId())
                .doesNotContain(joiner.getId());
    }

    @Test
    @DisplayName("탈퇴 ↔ 정산 배치 동시 실행 — 회차 잠금으로 직렬화되어 환불과 지급이 겹치지 않는다")
    void withdrawAndSettleRaceMovesMoneyOnce() throws Exception {
        User opener = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        LocalDate sessionDate = LocalDate.now(KST).minusDays(1);
        GroupChallengeBetSession session = openSession(sessionDate);
        participant(session, opener);
        participant(session, leaver);
        // 탈퇴자만 달성 — 정산이 이기면 탈퇴자가 팟(60) 전액을 받고, 탈퇴가 이기면 환불(30)만 받는다.
        focusStat(leaver, sessionDate, GOAL_MINUTES);

        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                groupMemberService.withdrawGroup(group.getId(), leaver.getId());
            });
            Future<?> settleCall = pool.submit(() -> {
                await(startTogether);
                groupBetSettler.settle(session.getId());
            });
            withdrawCall.get(30, TimeUnit.SECONDS);
            settleCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        long refunds = countOf(leaver, CurrencyTransactionType.BET_REFUND);
        long payouts = countOf(leaver, CurrencyTransactionType.BET_PAYOUT);
        GroupBetStatus finalStatus = statusOf(session);
        if (finalStatus == GroupBetStatus.SETTLED) {
            // 정산이 먼저 — 탈퇴자가 승자로 팟 전액을 받고, 탈퇴 연동은 OPEN 이 아니라 손대지 않았다.
            assertThat(payouts).isEqualTo(1);
            assertThat(refunds).isZero();
            assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
            assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
        } else {
            // 탈퇴가 먼저 — 탈퇴자 환불 후 잔류자 1명으로 정산이 돌았다(단독 미달성 → 몰수).
            assertThat(finalStatus).isEqualTo(GroupBetStatus.FORFEITED);
            assertThat(refunds).isEqualTo(1);
            assertThat(payouts).isZero();
            assertThat(balanceOf(leaver)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
            assertThat(balanceOf(opener)).isEqualTo(BALANCE_AFTER_STAKE);
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
