package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 챌린지 삭제 = OPEN 회차 무효화 + 전원 환불 회귀(GROMO-1272, FR-12·FR-13) — 종전 "OPEN 있으면
 * 삭제 차단"(CHALLENGE_HAS_OPEN_BET)의 to-be 전환을 실 DB 로 고정한다:
 * <ul>
 *   <li>삭제는 언제든 가능 — OPEN 회차(예약된 미래 포함)는 전부 VOIDED(CHALLENGE_DELETED) + 환불</li>
 *   <li>다건 회차 환불이 참가 행마다 <b>정확히 1회씩</b> — 원장 카운트로 검증</li>
 *   <li>정산 완료 회차는 불변(FR-13) — 상태·지급 기록이 흔들리지 않는다</li>
 *   <li>0명 OPEN 회차는 VOIDED 가 아니라 UNUSED(N52)</li>
 * </ul>
 */
class GroupChallengeDeleteVoidIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupChallengeService groupChallengeService;
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
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int STAKE = 30;
    private static final int BALANCE_AFTER_STAKE = 70;

    private Group group;
    private GroupChallenge challenge;
    private GroupChallengeBet config;
    private User owner;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(challenge).durationMinutes(120).build());
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
        groupChallengeBetSessionRepository.deleteAll(betSessions);
        groupChallengeBetRepository.delete(config);
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

    private GroupChallengeBetSession sessionOn(LocalDate date, GroupBetStatus status) {
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config).group(group).challenge(challenge)
                        .sessionDate(date).stake(STAKE).goalMinutes(120)
                        .missionCategory(challenge.getCategory())
                        .missionType(challenge.getType())
                        .status(status)
                        .startsAt(date.atStartOfDay(KST).toInstant())
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .settledAt(status == GroupBetStatus.OPEN ? null : Instant.now())
                        .build());
        betSessions.add(saved);
        return saved;
    }

    private GroupChallengeBetParticipant join(GroupChallengeBetSession session, User user) {
        return groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    private GroupChallengeBetSession reload(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow();
    }

    private long refundsOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_REFUND).count();
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    // ── 테스트 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("삭제 시 OPEN 회차(오늘 + 예약 미래) 전부 VOIDED(CHALLENGE_DELETED) — 참가 행마다 환불 정확히 1회")
    void deleteVoidsAllOpenSessionsAndRefundsExactlyOnceEach() {
        LocalDate today = LocalDate.now(KST);
        User a = memberUser("참가A", GroupMemberRole.MEMBER);
        User b = memberUser("참가B", GroupMemberRole.MEMBER);
        GroupChallengeBetSession todaySession = sessionOn(today, GroupBetStatus.OPEN);
        GroupChallengeBetSession tomorrowSession = sessionOn(today.plusDays(1), GroupBetStatus.OPEN);
        join(todaySession, a);
        join(todaySession, b);
        join(tomorrowSession, a);   // 같은 유저가 예약 회차에도 걸었다 — 회차별로 각각 환불돼야 한다.

        groupChallengeService.deleteChallenge(group.getId(), challenge.getId(), owner.getId());

        // 삭제 자체는 성사됐다.
        assertThat(groupChallengeRepository.findById(challenge.getId()).orElseThrow().getDeletedAt())
                .isNotNull();
        // OPEN 회차 전부 무효화 — 사유는 CHALLENGE_DELETED.
        for (GroupChallengeBetSession s : List.of(todaySession, tomorrowSession)) {
            GroupChallengeBetSession closed = reload(s);
            assertThat(closed.getStatus()).isEqualTo(GroupBetStatus.VOIDED);
            assertThat(closed.getVoidReason()).isEqualTo(GroupBetVoidReason.CHALLENGE_DELETED);
        }
        // 참가 행마다 환불 정확히 1회 — a 는 회차 2건이라 2회, b 는 1회.
        assertThat(refundsOf(a)).isEqualTo(2);
        assertThat(refundsOf(b)).isEqualTo(1);
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(b)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        // 환불 근거는 참가 행에 남고 판정은 비어 있다.
        assertThat(groupChallengeBetParticipantRepository
                .findBySessionIdIn(List.of(todaySession.getId(), tomorrowSession.getId())))
                .allSatisfy(p -> {
                    assertThat(p.getAchieved()).isNull();
                    assertThat(p.getPayout()).isEqualTo(STAKE);
                });
    }

    @Test
    @DisplayName("정산 완료 회차는 삭제가 건드리지 않는다(FR-13) — 상태·지급 불변, 재환불 없음")
    void deleteLeavesSettledSessionsUntouched() {
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);
        User a = memberUser("정산승자", GroupMemberRole.MEMBER);
        GroupChallengeBetSession settled = sessionOn(yesterday, GroupBetStatus.SETTLED);
        GroupChallengeBetParticipant participant = join(settled, a);
        participant.recordSettlement(true, STAKE, 120);
        groupChallengeBetParticipantRepository.save(participant);

        groupChallengeService.deleteChallenge(group.getId(), challenge.getId(), owner.getId());

        GroupChallengeBetSession after = reload(settled);
        assertThat(after.getStatus()).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(after.getVoidReason()).isNull();
        assertThat(refundsOf(a)).isZero();
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE);

        // 이미 삭제된 챌린지의 중복 DELETE 는 종전 계약대로 404 다.
        assertThatThrownBy(() -> groupChallengeService
                .deleteChallenge(group.getId(), challenge.getId(), owner.getId()))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("0명 OPEN 회차는 삭제 시 VOIDED 가 아니라 UNUSED 로 닫힌다(N52) — 돈 무변동")
    void deleteClosesEmptyOpenSessionAsUnused() {
        GroupChallengeBetSession empty = sessionOn(LocalDate.now(KST), GroupBetStatus.OPEN);

        groupChallengeService.deleteChallenge(group.getId(), challenge.getId(), owner.getId());

        GroupChallengeBetSession closed = reload(empty);
        assertThat(closed.getStatus()).isEqualTo(GroupBetStatus.UNUSED);
        assertThat(closed.getVoidReason()).isNull();
    }
}
