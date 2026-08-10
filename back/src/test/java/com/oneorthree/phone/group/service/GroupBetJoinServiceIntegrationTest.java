package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.domain.RepeatSchedule;
import com.oneorthree.phone.group.dto.JoinSessionResponse;
import com.oneorthree.phone.group.dto.JoinWeekRequest;
import com.oneorthree.phone.group.dto.JoinWeekResponse;
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
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 신 참여 3종(GROMO-1408)·가드 2종(GROMO-1409)·취소 분기(GROMO-1423) 통합 테스트 — 실 DB 로
 * 다음 회귀를 고정한다:
 *
 * <ul>
 *   <li>join-week 원자성 — 총액 부족이면 <b>전체 롤백</b>(부분 성공 금지), lazy 생성 회차까지 사라진다</li>
 *   <li>N39 — 마감·자격 가드에 걸린 오늘은 조용히 스킵되고 미래 예약은 산다</li>
 *   <li>N50 — 스크린타임 권한 가드가 차감(잔액 검사)보다 먼저다</li>
 *   <li>N54 — 탈퇴 커밋 직후의 참가는 멤버십 재검증에서 실패한다</li>
 *   <li>N22 — 취소 분기(시작 전/후 참가)와 그룹 탈퇴의 같은 규칙(FR-40)</li>
 *   <li>IDOR — 다른 그룹의 챌린지 id 는 404 (8차 리뷰)</li>
 * </ul>
 *
 * <p>활성 요일은 B1 머지 전 시임(매일 = 127) 기준이라 날짜 기대값을
 * {@link RepeatSchedule#remainingThisWeek} 로 테스트 안에서 같이 계산한다 — 요일 고정 기대값을
 * 박으면 실행 요일에 따라 흔들린다.
 */
class GroupBetJoinServiceIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetJoinService groupBetJoinService;
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
    UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    JdbcTemplate jdbcTemplate;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 30;
    private static final int BALANCE = 1_000;

    private Group group;
    private Group otherGroup;
    /** 기본 챌린지 — FOCUS × DURATION + 내기 설정(stake 30). */
    private GroupChallenge challenge;
    private GroupChallengeBet betConfig;
    private User member;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        otherGroup = groupRepository.save(Group.builder().name("남의 그룹").build());
        challenge = durationChallenge(group, MissionCategory.FOCUS);
        betConfig = configOf(challenge);
        member = memberUser("참가자", BALANCE);
    }

    @AfterEach
    void tearDown() {
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        // 회차·참가는 서비스가 lazy 생성하므로 그룹 스코프 SQL 로 일괄 정리한다.
        for (Group g : List.of(group, otherGroup)) {
            jdbcTemplate.update("DELETE FROM group_challenge_bet_participants WHERE session_id IN "
                    + "(SELECT id FROM group_challenge_bet_sessions WHERE group_id = ?)", g.getId());
            jdbcTemplate.update("DELETE FROM group_challenge_bet_sessions WHERE group_id = ?", g.getId());
            jdbcTemplate.update("DELETE FROM group_challenge_bets WHERE group_id = ?", g.getId());
        }
        challenges.forEach(c -> {
            groupChallengeDurationRepository.findById(c.getId())
                    .ifPresent(groupChallengeDurationRepository::delete);
            groupChallengeWindowRepository.findById(c.getId())
                    .ifPresent(groupChallengeWindowRepository::delete);
            groupChallengeRepository.delete(c);
        });
        users.forEach(u -> {
            userScreenTimeSettingsRepository.findById(u.getId())
                    .ifPresent(userScreenTimeSettingsRepository::delete);
            groupMemberRepository.findAnyByUserAndGroup(u, group).ifPresent(groupMemberRepository::delete);
            groupMemberRepository.findAnyByUserAndGroup(u, otherGroup)
                    .ifPresent(groupMemberRepository::delete);
            userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete);
        });
        userRepository.deleteAll(users);
        groupRepository.delete(group);
        groupRepository.delete(otherGroup);
        users.clear();
        challenges.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User memberUser(String nickname, int balance) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).balance(balance).build());
        groupMemberRepository.save(GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.MEMBER).build());
        users.add(user);
        return user;
    }

    private GroupChallenge durationChallenge(Group owner, MissionCategory category) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(owner).category(category).type(MissionType.DURATION).build());
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).durationMinutes(GOAL_MINUTES).build());
        challenges.add(saved);
        return saved;
    }

    /** 창형(FOCUS × TIME_WINDOW) — 창 00:00~00:15 라 실행 시각과 무관하게 오늘 창 시작이 항상 지났다. */
    private GroupChallenge startedWindowChallenge(Group owner) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(owner).category(MissionCategory.FOCUS).type(MissionType.TIME_WINDOW).build());
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(saved)
                .windowStartAt(LocalDate.EPOCH.atTime(LocalTime.MIDNIGHT).atZone(KST).toInstant())
                .windowEndAt(LocalDate.EPOCH.atTime(LocalTime.of(0, 15)).atZone(KST).toInstant())
                .durationMinutes(15)
                .build());
        challenges.add(saved);
        return saved;
    }

    private GroupChallengeBet configOf(GroupChallenge target) {
        return groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(target.getGroup()).challenge(target).stake(STAKE).enabled(true).build());
    }

    private static LocalDate today() {
        return LocalDate.now(KST);
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private long countByType(User user, CurrencyTransactionType type) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(tx -> tx.getType() == type)
                .count();
    }

    private void backdateParticipant(UUID participantId, Instant createdAt) {
        jdbcTemplate.update("UPDATE group_challenge_bet_participants SET created_at = ? WHERE id = ?",
                Timestamp.from(createdAt), participantId);
    }

    // ── join (오늘 회차) ─────────────────────────────────────────────────

    @Test
    @DisplayName("join — 오늘 회차가 없으면 lazy 개설 후 참가하고 참가비가 즉시 차감된다")
    void joinTodayCreatesSessionAndStakes() {
        JoinSessionResponse response = groupBetJoinService.joinToday(group.getId(), challenge.getId(),
                member.getId());

        assertThat(response.getSessionDate()).isEqualTo(today());
        assertThat(response.getStake()).isEqualTo(STAKE);
        assertThat(response.getBalanceAfter()).isEqualTo(BALANCE - STAKE);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
        GroupChallengeBetSession session = groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(betConfig.getId(), today()).orElseThrow();
        assertThat(session.getId()).isEqualTo(response.getSessionId());
        assertThat(session.isOpen()).isTrue();
        assertThat(session.getStake()).isEqualTo(STAKE);
        assertThat(session.getGoalMinutes()).isEqualTo(GOAL_MINUTES);
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(session.getId(), member.getId())).isTrue();

        assertThatThrownBy(() ->
                groupBetJoinService.joinToday(group.getId(), challenge.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_JOINED);
    }

    @Test
    @DisplayName("join — 창 시작이 지난 창형 오늘은 BET_CLOSED 고 회차도 남지 않는다 (N35 시각 조건)")
    void joinTodayRejectsStartedWindowWithoutLeakingSession() {
        GroupChallenge windowed = startedWindowChallenge(group);
        GroupChallengeBet windowedConfig = configOf(windowed);

        assertThatThrownBy(() ->
                groupBetJoinService.joinToday(group.getId(), windowed.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        // 트랜잭션 롤백 — lazy 생성이 시도됐어도 참가 마감 회차가 남으면 안 된다(N35).
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(windowedConfig.getId(), today())).isEmpty();
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
    }

    @Test
    @DisplayName("IDOR — 다른 그룹의 챌린지 id 를 끼워 넣으면 404 로 끊긴다 (1414)")
    void joinRejectsForeignChallengeId() {
        GroupChallenge foreign = durationChallenge(otherGroup, MissionCategory.FOCUS);
        configOf(foreign);

        for (ThrowingJoin call : List.<ThrowingJoin>of(
                () -> groupBetJoinService.joinToday(group.getId(), foreign.getId(), member.getId()),
                () -> groupBetJoinService.joinNext(group.getId(), foreign.getId(), member.getId()),
                () -> groupBetJoinService.joinWeek(group.getId(), foreign.getId(), member.getId(), null))) {
            assertThatThrownBy(call::run)
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_FOUND);
        }
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
    }

    private interface ThrowingJoin {
        void run();
    }

    // ── join-next (다음 활성일, N45) ─────────────────────────────────────

    @Test
    @DisplayName("join-next — 다음 활성일(시임: 내일) 회차를 lazy 생성해 예약하고, 재호출은 BET_ALREADY_JOINED")
    void joinNextReservesNextActiveDayOnce() {
        LocalDate expected = RepeatSchedule.next(RepeatSchedule.EVERYDAY, today());

        JoinSessionResponse response = groupBetJoinService.joinNext(group.getId(), challenge.getId(),
                member.getId());

        assertThat(response.getSessionDate()).isEqualTo(expected);
        assertThat(response.getBalanceAfter()).isEqualTo(BALANCE - STAKE);
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(betConfig.getId(), expected)).isPresent();

        assertThatThrownBy(() ->
                groupBetJoinService.joinNext(group.getId(), challenge.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_JOINED);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }

    // ── join-week (주간 부분 예약, N39) ──────────────────────────────────

    @Test
    @DisplayName("join-week — 본문 없이 부르면 이번 주 남은 활성일 전부를 예약하고, 재호출은 전부 스킵된다")
    void joinWeekReservesRemainingWeekThenSkipsAll() {
        List<LocalDate> expected = RepeatSchedule.remainingThisWeek(RepeatSchedule.EVERYDAY, today());

        JoinWeekResponse response = groupBetJoinService.joinWeek(group.getId(), challenge.getId(),
                member.getId(), null);

        assertThat(response.getJoined()).extracting(JoinWeekResponse.JoinedSession::getSessionDate)
                .containsExactlyElementsOf(expected);
        assertThat(response.getTotalStake()).isEqualTo(STAKE * expected.size());
        assertThat(response.getBalanceAfter()).isEqualTo(BALANCE - STAKE * expected.size());
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE * expected.size());

        // 이미 참가한 회차는 조용히 스킵 — 부분 예약 후 다시 누르는 것이 정상 동선이라 에러가 아니다.
        JoinWeekResponse again = groupBetJoinService.joinWeek(group.getId(), challenge.getId(),
                member.getId(), null);
        assertThat(again.getJoined()).isEmpty();
        assertThat(again.getTotalStake()).isZero();
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE * expected.size());
    }

    @Test
    @DisplayName("join-week 원자성 — 총액이 잔액을 넘으면 전체가 롤백되고 lazy 생성 회차도 남지 않는다")
    void joinWeekRollsBackEntirelyOnInsufficientTotalBalance() {
        GroupChallenge fresh = durationChallenge(group, MissionCategory.SCREEN_TIME);
        GroupChallengeBet freshConfig = configOf(fresh);
        List<LocalDate> expected = RepeatSchedule.remainingThisWeek(RepeatSchedule.EVERYDAY, today());
        // 총액에서 1 코인 모자라는 지갑 — 실행 요일과 무관하게 항상 총액 검사에 걸린다.
        User poor = memberUser("빈지갑", STAKE * expected.size() - 1);
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(poor.getId()).screenTimePermissionGranted(true).build());

        assertThatThrownBy(() ->
                groupBetJoinService.joinWeek(group.getId(), fresh.getId(), poor.getId(), null))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_INSUFFICIENT_BALANCE);

        // 부분 성공 금지 — 참가 0건, 차감 0건, lazy 생성된 회차까지 전부 롤백.
        assertThat(balanceOf(poor)).isEqualTo(STAKE * expected.size() - 1);
        assertThat(countByType(poor, CurrencyTransactionType.BET_STAKE)).isZero();
        for (LocalDate date : expected) {
            assertThat(groupChallengeBetSessionRepository
                    .findByBetIdAndSessionDate(freshConfig.getId(), date)).isEmpty();
        }
    }

    @Test
    @DisplayName("join-week N39 — 창 시작이 지난 오늘은 조용히 스킵되고 미래 예약만 산다")
    void joinWeekSilentlySkipsClosedToday() {
        GroupChallenge windowed = startedWindowChallenge(group);
        GroupChallengeBet windowedConfig = configOf(windowed);
        List<LocalDate> week = RepeatSchedule.remainingThisWeek(RepeatSchedule.EVERYDAY, today());
        List<LocalDate> expected = week.stream().filter(d -> !d.equals(today())).toList();

        JoinWeekResponse response = groupBetJoinService.joinWeek(group.getId(), windowed.getId(),
                member.getId(), null);

        assertThat(response.getJoined()).extracting(JoinWeekResponse.JoinedSession::getSessionDate)
                .containsExactlyElementsOf(expected);
        assertThat(response.getTotalStake()).isEqualTo(STAKE * expected.size());
        // 오늘 회차는 만들지도 않는다 — 참가 마감이 지난 OPEN 회차는 인원 0 무산·가짜 알림이 된다(N35).
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(windowedConfig.getId(), today())).isEmpty();
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE * expected.size());
    }

    @Test
    @DisplayName("join-week — 지정 날짜의 중복·과거·빈 목록은 INVALID_SESSION_DATES 400 이고 아무것도 남지 않는다")
    void joinWeekRejectsInvalidSessionDates() {
        List<List<LocalDate>> invalids = List.of(
                List.of(),
                List.of(today(), today()),
                List.of(today().minusDays(1)));
        for (List<LocalDate> dates : invalids) {
            JoinWeekRequest request = weekRequest(dates);
            assertThatThrownBy(() ->
                    groupBetJoinService.joinWeek(group.getId(), challenge.getId(), member.getId(), request))
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.INVALID_SESSION_DATES);
        }
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(betConfig.getId(), today().minusDays(1))).isEmpty();
    }

    @Test
    @DisplayName("join-week — 지정 날짜만 부분 예약한다 (§C2 「2일만 참여」)")
    void joinWeekReservesOnlySpecifiedDates() {
        JoinWeekResponse response = groupBetJoinService.joinWeek(group.getId(), challenge.getId(),
                member.getId(), weekRequest(List.of(today())));

        assertThat(response.getJoined()).extracting(JoinWeekResponse.JoinedSession::getSessionDate)
                .containsExactly(today());
        assertThat(response.getTotalStake()).isEqualTo(STAKE);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }

    /** 요청 DTO 는 역직렬화 전용(세터 없음) — 테스트에서는 리플렉션으로 채운다. */
    private JoinWeekRequest weekRequest(List<LocalDate> dates) {
        JoinWeekRequest request = new JoinWeekRequest();
        try {
            java.lang.reflect.Field field = JoinWeekRequest.class.getDeclaredField("sessionDates");
            field.setAccessible(true);
            field.set(request, dates);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return request;
    }

    // ── 가드 2종 (GROMO-1409) ───────────────────────────────────────────

    @Test
    @DisplayName("N50 — SCREEN_TIME 회차는 서버가 권한을 확인하고, 가드는 잔액 검사보다 먼저다")
    void screenTimePermissionGuardRunsBeforeBalanceCheck() {
        GroupChallenge screenTime = durationChallenge(group, MissionCategory.SCREEN_TIME);
        GroupChallengeBet screenTimeConfig = configOf(screenTime);
        // 잔액 0 + 권한 없음 — 잔액 검사가 먼저라면 BET_INSUFFICIENT_BALANCE 가 나와 순서 위반이 드러난다.
        User broke = memberUser("무일푼", 0);

        for (ThrowingJoin call : List.<ThrowingJoin>of(
                () -> groupBetJoinService.joinToday(group.getId(), screenTime.getId(), broke.getId()),
                () -> groupBetJoinService.joinNext(group.getId(), screenTime.getId(), broke.getId()),
                () -> groupBetJoinService.joinWeek(group.getId(), screenTime.getId(), broke.getId(), null))) {
            assertThatThrownBy(call::run)
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_SCREENTIME_PERMISSION_REQUIRED);
        }
        // 차감 전 가드 — 참가·회차·거래 어느 것도 남지 않는다.
        assertThat(countByType(broke, CurrencyTransactionType.BET_STAKE)).isZero();
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(screenTimeConfig.getId(), today())).isEmpty();

        // 권한 보고값이 false 여도 같다 — 행 부재와 미허용은 동급이다.
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(broke.getId()).screenTimePermissionGranted(false).build());
        assertThatThrownBy(() ->
                groupBetJoinService.joinToday(group.getId(), screenTime.getId(), broke.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_SCREENTIME_PERMISSION_REQUIRED);
    }

    @Test
    @DisplayName("N50 — 권한이 허용된 유저의 SCREEN_TIME 참여는 통과한다")
    void screenTimePermissionGrantedUserJoins() {
        GroupChallenge screenTime = durationChallenge(group, MissionCategory.SCREEN_TIME);
        configOf(screenTime);
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(member.getId()).screenTimePermissionGranted(true).build());

        JoinSessionResponse response = groupBetJoinService.joinToday(group.getId(), screenTime.getId(),
                member.getId());

        assertThat(response.getBalanceAfter()).isEqualTo(BALANCE - STAKE);
    }

    @Test
    @DisplayName("N54 — 탈퇴가 커밋된 직후의 참가는 활성 멤버십 재검증에서 실패한다")
    void joinFailsRightAfterWithdrawCommit() {
        // 탈퇴 트랜잭션이 커밋된 상태를 재현 — 참여의 멤버십 공유 잠금 조회는 is_left=false 만 본다.
        GroupMember membership = groupMemberRepository.findAnyByUserAndGroup(member, group).orElseThrow();
        membership.leave();
        groupMemberRepository.save(membership);

        for (ThrowingJoin call : List.<ThrowingJoin>of(
                () -> groupBetJoinService.joinToday(group.getId(), challenge.getId(), member.getId()),
                () -> groupBetJoinService.joinNext(group.getId(), challenge.getId(), member.getId()),
                () -> groupBetJoinService.joinWeek(group.getId(), challenge.getId(), member.getId(), null))) {
            assertThatThrownBy(call::run)
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        }
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
        assertThat(countByType(member, CurrencyTransactionType.BET_STAKE)).isZero();
    }

    // ── 취소 분기 (GROMO-1423 · N22) — 서비스 흐름 ───────────────────────

    @Test
    @DisplayName("N22 — 시작 후 참가(하루형)는 참가+5분 안에서만 무를 수 있다")
    void afterStartJoinLeavesOnlyWithinGrace() {
        JoinSessionResponse joined = groupBetJoinService.joinToday(group.getId(), challenge.getId(),
                member.getId());

        // 방금 참가(유예 안) — 취소 성공, 환불 1회, 단독 참가라 회차도 "없던 일".
        groupBetService.leaveBet(group.getId(), joined.getSessionId(), member.getId());
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(groupChallengeBetSessionRepository.findById(joined.getSessionId())).isEmpty();

        // 재참여 후 참가 시각을 6분 전으로 되돌리면(유예 밖) — BET_LEAVE_CLOSED, 환불 없음.
        JoinSessionResponse rejoined = groupBetJoinService.joinToday(group.getId(), challenge.getId(),
                member.getId());
        UUID participantId = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(rejoined.getSessionId(), member.getId()).orElseThrow().getId();
        backdateParticipant(participantId, Instant.now().minus(Duration.ofMinutes(6)));

        assertThatThrownBy(() ->
                groupBetService.leaveBet(group.getId(), rejoined.getSessionId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }

    @Test
    @DisplayName("N22 — 예약분(미래 회차)은 회차 시작까지 무를 수 있고, 시작 전 참가는 시작 후 취소가 막힌다")
    void reservedSessionLeavesUntilItsStart() {
        // 예약분 — 내일 회차는 시작 전이라 취소 가능(5분 유예와 무관).
        JoinSessionResponse reserved = groupBetJoinService.joinNext(group.getId(), challenge.getId(),
                member.getId());
        UUID reservedParticipant = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(reserved.getSessionId(), member.getId()).orElseThrow().getId();
        // 참가 시각이 6분 전이어도 시작 전 참가는 회차 시작까지 취소가 열려 있어야 한다.
        backdateParticipant(reservedParticipant, Instant.now().minus(Duration.ofMinutes(6)));
        groupBetService.leaveBet(group.getId(), reserved.getSessionId(), member.getId());
        assertThat(balanceOf(member)).isEqualTo(BALANCE);

        // 시작 전 참가 + 회차 시작 경과 — 5분 유예가 붙으면 "시작 후 환불 없음"이 깨진다.
        JoinSessionResponse today = groupBetJoinService.joinToday(group.getId(), challenge.getId(),
                member.getId());
        UUID todayParticipant = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(today.getSessionId(), member.getId()).orElseThrow().getId();
        // 참가 시각을 회차 시작(오늘 00:00 KST) 전으로 되돌린다 — "시작 전에 참가" 분기 강제.
        backdateParticipant(todayParticipant,
                today().atStartOfDay(KST).toInstant().minus(Duration.ofHours(1)));
        assertThatThrownBy(() ->
                groupBetService.leaveBet(group.getId(), today.getSessionId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
    }

    @Test
    @DisplayName("FR-40 — 그룹 탈퇴 정리도 같은 규칙: 취소 마감 지난 회차는 정산 잔류, 시작 전 회차만 환불")
    void groupWithdrawKeepsStartedSessionsAndRefundsFutureOnes() {
        // 오늘 회차(시작 후 참가) — 참가 시각을 유예 밖으로 되돌려 "취소 마감 경과" 상태를 만든다.
        JoinSessionResponse todaySession = groupBetJoinService.joinToday(group.getId(), challenge.getId(),
                member.getId());
        UUID todayParticipant = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(todaySession.getSessionId(), member.getId()).orElseThrow().getId();
        backdateParticipant(todayParticipant, Instant.now().minus(Duration.ofMinutes(6)));
        // 내일 회차(예약분) — 시작 전이라 탈퇴 시 환불 대상.
        JoinSessionResponse reserved = groupBetJoinService.joinNext(group.getId(), challenge.getId(),
                member.getId());

        groupBetService.releaseFromOpenBets(member, group);

        // 시작된 회차: 참가·에스크로가 정산 대상으로 남는다(명단은 정산 시 "탈퇴한 사용자").
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(todaySession.getSessionId(), member.getId())).isTrue();
        assertThat(groupChallengeBetSessionRepository.findById(todaySession.getSessionId())).isPresent();
        // 시작 전 회차: 환불 + 참가 제거, 마지막 참가자였으니 회차도 "없던 일".
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(reserved.getSessionId(), member.getId())).isFalse();
        assertThat(groupChallengeBetSessionRepository.findById(reserved.getSessionId())).isEmpty();
        // 환불은 정확히 1회(예약분) — 오늘 참가비는 판에 남아 잔액은 BALANCE - STAKE.
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }
}
