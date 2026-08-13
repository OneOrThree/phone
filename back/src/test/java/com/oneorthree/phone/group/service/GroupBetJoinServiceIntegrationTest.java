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
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
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
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

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
 * <p>날짜 기대값은 {@link RepeatSchedule} 로 테스트 안에서 같이 계산한다 — 요일 고정 기대값을
 * 박으면 실행 요일에 따라 흔들린다. 요일 반복 판정(FR-30)은 "오늘 요일만 활성"인 챌린지로
 * 결정적으로 재현한다(같은 요일은 이번 주에 다시 오지 않는다).
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
    DailyFocusStatRepository dailyFocusStatRepository;
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
        users.forEach(u -> dailyFocusStatRepository
                .deleteAll(dailyFocusStatRepository.findByUserIdInAndDate(List.of(u.getId()), today())));
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
        return durationChallenge(owner, category, RepeatSchedule.EVERYDAY);
    }

    /** 활성 요일 마스크를 지정하는 하루형 챌린지 — 요일 반복 판정(FR-30·§A3) 테스트용. */
    private GroupChallenge durationChallenge(Group owner, MissionCategory category, int repeatDays) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(owner).category(category).type(MissionType.DURATION)
                .repeatDays(repeatDays).build());
        // V36(GROMO-1405) 이후 category 는 NOT NULL 비정규화 사본이다 — 복합 FK 가 부모와 일치를
        // 강제하므로 부모 챌린지와 같은 값을 넣어야 한다.
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).category(category).durationMinutes(GOAL_MINUTES).build());
        challenges.add(saved);
        return saved;
    }

    /** 창형(FOCUS × TIME_WINDOW) — 창 00:00~00:15 라 실행 시각과 무관하게 오늘 창 시작이 항상 지났다. */
    private GroupChallenge startedWindowChallenge(Group owner) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(owner).category(MissionCategory.FOCUS).type(MissionType.TIME_WINDOW).build());
        // V35(GROMO-1406) 이후 창 시각은 KST 벽시계 time 이다 — EPOCH 앵커 Instant 변환이 필요 없다.
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(saved)
                .windowStart(LocalTime.MIDNIGHT)
                .windowEnd(LocalTime.of(0, 15))
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

    /**
     * 하루형 OPEN 회차 — 00:05 스케줄러가 세워 둔 상태를 재현한다. 단건 참여({@code joinSession})는
     * 회차가 <b>이미 있어야</b> 호출되는 축이라(LLD §2.2) 픽스처로 미리 세운다.
     */
    private GroupChallengeBetSession openSessionOn(
            GroupChallenge target, GroupChallengeBet config, LocalDate date) {
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        return groupChallengeBetSessionRepository.save(GroupChallengeBetSession.builder()
                .bet(config).group(group).challenge(target)
                .sessionDate(date)
                .stake(STAKE)
                .goalMinutes(target.getType() == MissionType.TIME_WINDOW ? 15 : GOAL_MINUTES)
                .missionCategory(target.getCategory())
                .missionType(target.getType())
                .status(GroupBetStatus.OPEN)
                .startsAt(date.atStartOfDay(KST).toInstant())
                .joinClosesAt(closesAt)
                .closesAt(closesAt)
                .settleAfter(closesAt)
                .build());
    }

    /** 오늘 회차(기본 챌린지) — 가장 많이 쓰는 형태. */
    private GroupChallengeBetSession todaySession() {
        return openSessionOn(challenge, betConfig, today());
    }

    // ── join (회차 단건, LLD §2.2) ───────────────────────────────────────

    @Test
    @DisplayName("join — 지목한 회차에 참가하고 참가비가 즉시 차감된다. 재호출은 BET_ALREADY_JOINED")
    void joinSessionStakesAndRejectsDuplicate() {
        GroupChallengeBetSession session = todaySession();

        JoinSessionResponse response = groupBetJoinService.joinSession(group.getId(), session.getId(),
                member.getId());

        assertThat(response.getSessionId()).isEqualTo(session.getId());
        assertThat(response.getSessionDate()).isEqualTo(today());
        assertThat(response.getStake()).isEqualTo(STAKE);
        assertThat(response.getBalanceAfter()).isEqualTo(BALANCE - STAKE);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(session.getId(), member.getId())).isTrue();

        assertThatThrownBy(() ->
                groupBetJoinService.joinSession(group.getId(), session.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_ALREADY_JOINED);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }

    @Test
    @DisplayName("join — 참가 마감(joinClosesAt = 창 시작)이 지난 창형 회차는 BET_CLOSED (FR-33)")
    void joinSessionRejectsAfterJoinCloses() {
        GroupChallenge windowed = startedWindowChallenge(group);
        GroupChallengeBet windowedConfig = configOf(windowed);
        // 창 00:00~00:15 회차 — 박제 joinClosesAt(창 시작)이 이미 지났다. 레거시 브리지는 창 종료까지
        // 열어 두지만 신 경로는 joinClosesAt 을 강제한다.
        Instant windowStart = today().atStartOfDay(KST).toInstant();
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(windowedConfig).group(group).challenge(windowed)
                        .sessionDate(today())
                        .stake(STAKE)
                        .goalMinutes(15)
                        .missionCategory(MissionCategory.FOCUS)
                        .missionType(MissionType.TIME_WINDOW)
                        .windowStart(LocalTime.MIDNIGHT)
                        .windowEnd(LocalTime.of(0, 15))
                        .status(GroupBetStatus.OPEN)
                        .startsAt(windowStart)
                        .joinClosesAt(windowStart)
                        .closesAt(windowStart.plusSeconds(900))
                        .settleAfter(windowStart.plusSeconds(900))
                        .build());

        assertThatThrownBy(() ->
                groupBetJoinService.joinSession(group.getId(), session.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_CLOSED);
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
        assertThat(countByType(member, CurrencyTransactionType.BET_STAKE)).isZero();
    }

    @Test
    @DisplayName("IDOR — 남의 그룹 회차 id·챌린지 id 를 끼워 넣으면 404 로 끊긴다 (1414)")
    void joinRejectsForeignIds() {
        GroupChallenge foreign = durationChallenge(otherGroup, MissionCategory.FOCUS);
        GroupChallengeBet foreignConfig = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(otherGroup).challenge(foreign).stake(STAKE).enabled(true).build());
        Instant closesAt = today().plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession foreignSession = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(foreignConfig).group(otherGroup).challenge(foreign)
                        .sessionDate(today()).stake(STAKE).goalMinutes(GOAL_MINUTES)
                        .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                        .status(GroupBetStatus.OPEN)
                        .startsAt(today().atStartOfDay(KST).toInstant())
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .build());

        // 회차 축 — 내 그룹 경로에 남의 회차 id → BET_NOT_FOUND(그룹 스코프 검증)
        assertThatThrownBy(() ->
                groupBetJoinService.joinSession(group.getId(), foreignSession.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_NOT_FOUND);
        // 챌린지 축 — 남의 챌린지 id → NOT_FOUND
        for (ThrowingJoin call : List.<ThrowingJoin>of(
                () -> groupBetJoinService.joinNext(group.getId(), foreign.getId(), member.getId()),
                () -> groupBetJoinService.joinWeek(group.getId(), foreign.getId(), member.getId(), null))) {
            assertThatThrownBy(call::run)
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.NOT_FOUND);
        }
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(foreignSession.getId(), member.getId())).isFalse();
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

    @Test
    @DisplayName("join-next — 비활성 요일은 건너뛴다: 오늘 요일만 도는 챌린지는 다음 주 같은 요일(+7)")
    void joinNextSkipsInactiveWeekdays() {
        // 활성 요일이 오늘 하나뿐인 챌린지 — 시임이 EVERYDAY 로 굳어 있으면 "내일" 회차를 만들고
        // 참가비를 걷는다(FR-30 위반, 돈 경로). 실행 요일과 무관하게 결정적이다.
        int todayOnly = RepeatSchedule.bit(today().getDayOfWeek());
        GroupChallenge weekly = durationChallenge(group, MissionCategory.SCREEN_TIME, todayOnly);
        GroupChallengeBet weeklyConfig = configOf(weekly);
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(member.getId()).screenTimePermissionGranted(true).build());

        JoinSessionResponse response = groupBetJoinService.joinNext(group.getId(), weekly.getId(),
                member.getId());

        assertThat(response.getSessionDate()).isEqualTo(today().plusDays(7));
        // 내일(비활성 요일) 회차는 만들어지지도 않았다.
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(weeklyConfig.getId(), today().plusDays(1))).isEmpty();
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }

    @Test
    @DisplayName("join-week — 비활성 요일에는 회차도 참가비도 없다: 오늘 요일만 도는 챌린지는 오늘 1건")
    void joinWeekCoversOnlyActiveWeekdays() {
        int todayOnly = RepeatSchedule.bit(today().getDayOfWeek());
        GroupChallenge weekly = durationChallenge(group, MissionCategory.SCREEN_TIME, todayOnly);
        GroupChallengeBet weeklyConfig = configOf(weekly);
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(member.getId()).screenTimePermissionGranted(true).build());

        JoinWeekResponse response = groupBetJoinService.joinWeek(group.getId(), weekly.getId(),
                member.getId(), null);

        // 같은 요일은 이번 주에 다시 오지 않는다 — 남은 활성일은 오늘 하나뿐.
        assertThat(response.getJoined()).extracting(JoinWeekResponse.JoinedSession::getSessionDate)
                .containsExactly(today());
        assertThat(response.getTotalStake()).isEqualTo(STAKE);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
        // 나머지 요일에는 회차 자체가 서지 않는다(EVERYDAY 시임이었다면 여기서 드러난다).
        for (int i = 1; i <= 6; i++) {
            assertThat(groupChallengeBetSessionRepository
                    .findByBetIdAndSessionDate(weeklyConfig.getId(), today().plusDays(i))).isEmpty();
        }
    }

    @Test
    @DisplayName("join-week 지정 날짜 — 비활성 요일을 찍으면 INVALID_SESSION_DATES 400")
    void joinWeekRejectsInactiveWeekday() {
        int todayOnly = RepeatSchedule.bit(today().getDayOfWeek());
        GroupChallenge weekly = durationChallenge(group, MissionCategory.SCREEN_TIME, todayOnly);
        GroupChallengeBet weeklyConfig = configOf(weekly);
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(member.getId()).screenTimePermissionGranted(true).build());
        JoinWeekRequest request = weekRequest(List.of(today().plusDays(1)));

        assertThatThrownBy(() ->
                groupBetJoinService.joinWeek(group.getId(), weekly.getId(), member.getId(), request))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.INVALID_SESSION_DATES);
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(weeklyConfig.getId(), today().plusDays(1))).isEmpty();
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

        GroupChallengeBetSession session = openSessionOn(screenTime, screenTimeConfig, today());

        for (ThrowingJoin call : List.<ThrowingJoin>of(
                () -> groupBetJoinService.joinSession(group.getId(), session.getId(), broke.getId()),
                () -> groupBetJoinService.joinNext(group.getId(), screenTime.getId(), broke.getId()),
                () -> groupBetJoinService.joinWeek(group.getId(), screenTime.getId(), broke.getId(), null))) {
            assertThatThrownBy(call::run)
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_SCREENTIME_PERMISSION_REQUIRED);
        }
        // 차감 전 가드 — 참가·거래 어느 것도 남지 않고, 예약 경로가 만들 뻔한 미래 회차도 롤백된다.
        assertThat(countByType(broke, CurrencyTransactionType.BET_STAKE)).isZero();
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(session.getId(), broke.getId())).isFalse();
        assertThat(groupChallengeBetSessionRepository.findByBetIdAndSessionDate(
                screenTimeConfig.getId(), RepeatSchedule.next(RepeatSchedule.EVERYDAY, today()))).isEmpty();

        // 권한 보고값이 false 여도 같다 — 행 부재와 미허용은 동급이다.
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(broke.getId()).screenTimePermissionGranted(false).build());
        assertThatThrownBy(() ->
                groupBetJoinService.joinSession(group.getId(), session.getId(), broke.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_SCREENTIME_PERMISSION_REQUIRED);
    }

    @Test
    @DisplayName("N50 — 권한이 허용된 유저의 SCREEN_TIME 참여는 통과한다")
    void screenTimePermissionGrantedUserJoins() {
        GroupChallenge screenTime = durationChallenge(group, MissionCategory.SCREEN_TIME);
        GroupChallengeBetSession session = openSessionOn(screenTime, configOf(screenTime), today());
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(member.getId()).screenTimePermissionGranted(true).build());

        JoinSessionResponse response = groupBetJoinService.joinSession(group.getId(), session.getId(),
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

        GroupChallengeBetSession session = todaySession();
        for (ThrowingJoin call : List.<ThrowingJoin>of(
                () -> groupBetJoinService.joinSession(group.getId(), session.getId(), member.getId()),
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
        GroupChallengeBetSession session = todaySession();
        JoinSessionResponse joined = groupBetJoinService.joinSession(group.getId(), session.getId(),
                member.getId());

        // 방금 참가(유예 안) — 취소 성공, 환불 1회, 단독 참가라 회차도 "없던 일".
        groupBetService.leaveBet(group.getId(), joined.getSessionId(), member.getId());
        assertThat(balanceOf(member)).isEqualTo(BALANCE);
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(groupChallengeBetSessionRepository.findById(joined.getSessionId())).isEmpty();

        // 재참여 후 참가 시각을 6분 전으로 되돌리면(유예 밖) — BET_LEAVE_CLOSED, 환불 없음.
        GroupChallengeBetSession reopened = todaySession();
        JoinSessionResponse rejoined = groupBetJoinService.joinSession(group.getId(), reopened.getId(),
                member.getId());
        UUID participantId = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(rejoined.getSessionId(), member.getId()).orElseThrow().getId();
        backdateParticipant(participantId, Instant.now().minus(Duration.ofMinutes(6)));

        assertThatThrownBy(() ->
                groupBetService.leaveBet(group.getId(), rejoined.getSessionId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);

        // 레거시 취소 브리지도 같은 마감을 본다(codex P1 ② — 신 참여 sessionId 로 마감 우회 금지).
        assertThatThrownBy(() ->
                groupBetService.cancelBet(group.getId(), rejoined.getSessionId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
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
        JoinSessionResponse today = groupBetJoinService.joinSession(group.getId(),
                todaySession().getId(), member.getId());
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
        JoinSessionResponse todayJoined = groupBetJoinService.joinSession(group.getId(),
                todaySession().getId(), member.getId());
        UUID todayParticipant = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(todayJoined.getSessionId(), member.getId()).orElseThrow().getId();
        backdateParticipant(todayParticipant, Instant.now().minus(Duration.ofMinutes(6)));
        // 내일 회차(예약분) — 시작 전이라 탈퇴 시 환불 대상.
        JoinSessionResponse reserved = groupBetJoinService.joinNext(group.getId(), challenge.getId(),
                member.getId());

        groupBetService.releaseFromOpenBets(member, group);

        // 시작된 회차: 참가·에스크로가 정산 대상으로 남는다(명단은 정산 시 "탈퇴한 사용자").
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(todayJoined.getSessionId(), member.getId())).isTrue();
        assertThat(groupChallengeBetSessionRepository.findById(todayJoined.getSessionId())).isPresent();
        // 시작 전 회차: 환불 + 참가 제거, 마지막 참가자였으니 회차도 "없던 일".
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(reserved.getSessionId(), member.getId())).isFalse();
        assertThat(groupChallengeBetSessionRepository.findById(reserved.getSessionId())).isEmpty();
        // 환불은 정확히 1회(예약분) — 오늘 참가비는 판에 남아 잔액은 BALANCE - STAKE.
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isEqualTo(1);
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }

    @Test
    @DisplayName("N22 창형 — 레거시 경로로 창 시작 후 참가한 사람은 유예 없이 즉시 취소 불가 (관전 후 이탈 차단)")
    void windowParticipantJoinedAfterStartCannotLeaveOrCancel() {
        GroupChallenge windowed = startedWindowChallenge(group);
        GroupChallengeBet windowedConfig = configOf(windowed);
        // 창 09:00~11:00 이 이미 시작된 상태를 박제 시각으로 재현한다(레거시 참가 경로는 창 종료까지
        // 참가를 허용하므로 createdAt >= startsAt 인 창형 참가자가 실제로 존재한다).
        Instant windowStart = Instant.now().minus(Duration.ofMinutes(30));
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(windowedConfig).group(group).challenge(windowed)
                        .sessionDate(today()).stake(STAKE).goalMinutes(15)
                        .missionCategory(MissionCategory.FOCUS)
                        .missionType(MissionType.TIME_WINDOW)
                        .windowStart(LocalTime.MIDNIGHT).windowEnd(LocalTime.of(0, 15))
                        .status(GroupBetStatus.OPEN)
                        .startsAt(windowStart)
                        .joinClosesAt(windowStart)
                        .closesAt(windowStart.plus(Duration.ofHours(2)))
                        .settleAfter(windowStart.plus(Duration.ofHours(2)))
                        .build());
        // 창 시작 1분 뒤 참가(= 방금 참가) — 하루형 규칙이었다면 5분 유예 안이라 무를 수 있었다.
        GroupChallengeBetParticipant mine = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(member).build());
        backdateParticipant(mine.getId(), windowStart.plus(Duration.ofMinutes(1)));

        assertThatThrownBy(() ->
                groupBetService.leaveBet(group.getId(), session.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        // 단독 참가자라 레거시 취소 브리지 조건도 만족하지만 같은 마감에 막힌다.
        assertThatThrownBy(() ->
                groupBetService.cancelBet(group.getId(), session.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_LEAVE_CLOSED);
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isZero();
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(session.getId(), member.getId())).isTrue();
    }

    // ── 계정 탈퇴 근거 박제 (codex P1 ① 회귀) ────────────────────────────

    @Test
    @DisplayName("탈퇴 근거 박제는 환불하지 않는다 — 마감 지난 참가는 행·에스크로가 그대로 남는다")
    void freezeEvidenceNeverRefundsOrDeletesParticipation() {
        // 병합 충돌 해소가 박제 루프 안에 delete + refundStake 를 되살렸던 회귀(FR-40 우회 환불).
        // UserService.withdraw 와 같은 순서(해제 → 박제)로 부른다.
        GroupChallengeBetSession session = todaySession();
        groupBetJoinService.joinSession(group.getId(), session.getId(), member.getId());
        UUID participantId = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(session.getId(), member.getId()).orElseThrow().getId();
        backdateParticipant(participantId, Instant.now().minus(Duration.ofMinutes(6)));   // 취소 마감 경과

        groupBetService.releaseFromAllOpenBets(member);
        groupBetService.freezeEvidenceForAccountErasure(member);

        // 참가 행·회차 잔존 + 환불 0 — 계정 탈퇴가 취소 마감을 우회하는 환불 경로가 아니다.
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(session.getId(), member.getId())).isTrue();
        assertThat(groupChallengeBetSessionRepository.findById(session.getId())).isPresent();
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isZero();
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
    }

    @Test
    @DisplayName("탈퇴 근거 박제 — 달성 상태면 achieved/progressMinutes 가 참가 행에 박제된다")
    void freezeEvidenceRecordsAchievementSnapshot() {
        GroupChallengeBetSession session = todaySession();
        groupBetJoinService.joinSession(group.getId(), session.getId(), member.getId());
        UUID participantId = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(session.getId(), member.getId()).orElseThrow().getId();
        backdateParticipant(participantId, Instant.now().minus(Duration.ofMinutes(6)));
        // 목표(120분) 이상 집중한 상태 — nullify 전이라면 정산이 달성으로 볼 값이다.
        dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(member).date(today()).totalFocusSeconds((GOAL_MINUTES + 10) * 60).build());

        groupBetService.releaseFromAllOpenBets(member);
        groupBetService.freezeEvidenceForAccountErasure(member);

        GroupChallengeBetParticipant frozen = groupChallengeBetParticipantRepository
                .findById(participantId).orElseThrow();
        assertThat(frozen.getAchieved()).isTrue();
        assertThat(frozen.getProgressMinutes()).isEqualTo(GOAL_MINUTES + 10);
        assertThat(countByType(member, CurrencyTransactionType.BET_REFUND)).isZero();
    }

    // ── lazy 개설 경합 (codex P1 ① 회귀) ─────────────────────────────────

    @Test
    @DisplayName("동시 join-next — 회차 유니크 경합에서 진 쪽도 승자 회차로 합류한다 (ON CONFLICT DO NOTHING)")
    void concurrentJoinNextConvergesOnSingleSession() throws Exception {
        // 구현이 saveAndFlush + DataIntegrityViolation catch 였을 때: Postgres 가 제약 위반 시 트랜잭션을
        // aborted 로 만들어 catch 안의 재조회가 "current transaction is aborted" 로 죽었다 — 진 쪽은
        // 승자 행으로 합류하지 못하고 500 + 전체 롤백이었다.
        User second = memberUser("동시참가자", BALANCE);
        LocalDate expected = RepeatSchedule.next(RepeatSchedule.EVERYDAY, today());
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<JoinSessionResponse>> calls = List.of(member, second).stream()
                    .map(user -> pool.submit(() -> {
                        startTogether.await(10, TimeUnit.SECONDS);
                        return groupBetJoinService.joinNext(group.getId(), challenge.getId(), user.getId());
                    }))
                    .toList();
            // 둘 다 성공해야 한다 — 경합에서 진 쪽이 예외로 죽으면 여기서 드러난다.
            List<UUID> sessionIds = new ArrayList<>();
            for (Future<JoinSessionResponse> call : calls) {
                sessionIds.add(call.get(20, TimeUnit.SECONDS).getSessionId());
            }
            // 같은 회차 1건으로 수렴(UNIQUE (bet_id, session_date))하고 둘 다 참가자다.
            assertThat(sessionIds).hasSize(2).containsOnly(sessionIds.get(0));
            UUID sessionId = groupChallengeBetSessionRepository
                    .findByBetIdAndSessionDate(betConfig.getId(), expected).orElseThrow().getId();
            assertThat(sessionIds).containsOnly(sessionId);
            assertThat(groupChallengeBetParticipantRepository.countBySessionId(sessionId)).isEqualTo(2);
        } finally {
            pool.shutdownNow();
        }
        assertThat(balanceOf(member)).isEqualTo(BALANCE - STAKE);
        assertThat(balanceOf(second)).isEqualTo(BALANCE - STAKE);
    }
}
