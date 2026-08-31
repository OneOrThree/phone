package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
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
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

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
    private final List<GroupChallenge> extraChallenges = new ArrayList<>();
    private final List<GroupChallengeBet> extraConfigs = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        // category 는 V36 이후 NOT NULL — 복합 FK 가 부모 챌린지 카테고리와의 일치를 강제한다.
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(challenge).category(MissionCategory.FOCUS).durationMinutes(120).build());
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
        groupChallengeBetRepository.deleteAll(extraConfigs);
        extraChallenges.forEach(c -> groupChallengeDurationRepository.findById(c.getId())
                .ifPresent(groupChallengeDurationRepository::delete));
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
        betSessions.clear();
        extraChallenges.clear();
        extraConfigs.clear();
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

    /** 두 번째 챌린지(+설정) — 동시 삭제 교착 재현용. */
    private GroupChallengeBet secondChallengeConfig() {
        GroupChallenge other = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.SCREEN_TIME).type(MissionType.DURATION).build());
        extraChallenges.add(other);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(other).category(MissionCategory.SCREEN_TIME).durationMinutes(120).build());
        GroupChallengeBet otherConfig = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(other).stake(STAKE).enabled(true).build());
        extraConfigs.add(otherConfig);
        return otherConfig;
    }

    /** 지정 설정·챌린지의 OPEN 회차. */
    private GroupChallengeBetSession openSessionFor(GroupChallengeBet betConfig, LocalDate date) {
        GroupChallenge target = betConfig.getChallenge();
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(betConfig).group(group).challenge(target)
                        .sessionDate(date).stake(STAKE).goalMinutes(120)
                        .missionCategory(target.getCategory())
                        .missionType(target.getType())
                        .status(GroupBetStatus.OPEN)
                        .startsAt(date.atStartOfDay(KST).toInstant())
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
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
    @DisplayName("여러 회차 환불의 지갑 순서는 전역이다 — 겹치는 참가자도 회차마다 정확히 1회 환불(②)")
    void refundsAcrossSessionsUseGlobalWalletOrder() {
        LocalDate today = LocalDate.now(KST);
        User a = memberUser("겹침A", GroupMemberRole.MEMBER);
        User b = memberUser("겹침B", GroupMemberRole.MEMBER);
        // 한 챌린지의 여러 회차(오늘·내일)에 두 유저가 순서를 뒤집어 참가한다 — 회차 안에서만
        // 정렬하면 지갑 접근 순서가 회차마다 갈린다(교착의 씨앗). 전역 정렬이면 항상 단조롭다.
        GroupChallengeBetSession first = sessionOn(today, GroupBetStatus.OPEN);
        GroupChallengeBetSession second = sessionOn(today.plusDays(1), GroupBetStatus.OPEN);
        join(first, a);
        join(first, b);
        join(second, b);
        join(second, a);

        groupChallengeService.deleteChallenge(group.getId(), challenge.getId(), owner.getId());

        assertThat(reload(first).getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        assertThat(reload(second).getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        // 회차 수만큼 정확히 한 번씩 — 전역 정렬로 순서를 바꿔도 멱등키(참가 행 축)는 그대로다.
        assertThat(refundsOf(a)).isEqualTo(2);
        assertThat(refundsOf(b)).isEqualTo(2);
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(b)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
    }

    @Test
    @DisplayName("참가자가 겹치는 두 챌린지를 동시에 삭제해도 양쪽이 완주한다 — 지갑 비관 락 + 전역 순서(②)")
    void concurrentDeletesWithSharedParticipantsBothComplete() throws Exception {
        LocalDate today = LocalDate.now(KST);
        // 두 유저가 <b>양쪽 챌린지에 모두</b> 참가한다 — 같은 지갑을 두 삭제가 동시에 건드린다.
        // 낙관락만 있던 시절엔 늦은 쪽이 0행 갱신으로 터져 그 삭제가 통째로 롤백됐다.
        User onlyFirst = memberUser("겹침A", GroupMemberRole.MEMBER);
        User onlySecond = memberUser("겹침B", GroupMemberRole.MEMBER);
        GroupChallengeBet otherConfig = secondChallengeConfig();
        GroupChallengeBetSession first = sessionOn(today, GroupBetStatus.OPEN);
        GroupChallengeBetSession firstTomorrow = sessionOn(today.plusDays(1), GroupBetStatus.OPEN);
        GroupChallengeBetSession second = openSessionFor(otherConfig, today);
        GroupChallengeBetSession secondTomorrow = openSessionFor(otherConfig, today.plusDays(1));
        // 회차마다 참가 순서를 뒤집어 넣어, 정렬이 없으면 지갑 접근 순서가 갈리도록 만든다.
        join(first, onlyFirst);
        join(first, onlySecond);
        join(firstTomorrow, onlySecond);
        join(firstTomorrow, onlyFirst);
        join(second, onlySecond);
        join(second, onlyFirst);
        join(secondTomorrow, onlyFirst);
        join(secondTomorrow, onlySecond);

        UUID otherChallengeId = otherConfig.getChallenge().getId();
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> deleteFirst = pool.submit(() -> {
                await(startTogether);
                groupChallengeService.deleteChallenge(group.getId(), challenge.getId(), owner.getId());
            });
            Future<?> deleteSecond = pool.submit(() -> {
                await(startTogether);
                groupChallengeService.deleteChallenge(group.getId(), otherChallengeId, owner.getId());
            });
            // 교착이면 타임아웃/DeadlockLoserDataAccessException, 낙관락 회귀면
            // ObjectOptimisticLockingFailureException 으로 여기서 터진다.
            deleteFirst.get(30, TimeUnit.SECONDS);
            deleteSecond.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 양쪽 삭제가 모두 성사되고 네 회차 전부 무효화된다 — 한쪽도 롤백되지 않았다.
        assertThat(reload(first).getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        assertThat(reload(firstTomorrow).getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        assertThat(reload(second).getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        assertThat(reload(secondTomorrow).getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        // 각 유저는 참가한 회차 수(4)만큼 정확히 한 번씩 환불받는다 — 이중도 누락도 없다.
        assertThat(refundsOf(onlyFirst)).isEqualTo(4);
        assertThat(refundsOf(onlySecond)).isEqualTo(4);
        assertThat(balanceOf(onlyFirst)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 4);
        assertThat(balanceOf(onlySecond)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 4);
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
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
