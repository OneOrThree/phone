package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeMember;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
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

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 내기 4조합(FOCUS·SCREEN_TIME × DURATION·TIME_WINDOW) 정산 통합 테스트 — 조합마다 <b>판정 소스가
 * 다르다</b>는 것이 이 파일의 전부다. 2계층 재편(GROMO-1262) 후 정산 단위는 <b>회차</b>다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는다({@link IntegrationTestBase}) — 정산은 회차 단위로
 * 커밋되기 때문이다. 테스트가 만든 행은 {@code @AfterEach} 에서 FK 역순으로 직접 지운다.
 *
 * <p>멱등·CAS·몰수 원장 무기록 같은 조합 무관 성질은 {@link GroupBetSettlementIntegrationTest} 가
 * 이미 고정한다. 여기서는 조합별 판정 + 잔여 배분 방향 + 카테고리별 배치 분리만 본다.
 */
class GroupBetCategorySettlementIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetSettlementService groupBetSettlementService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Autowired
    GroupChallengeMemberRepository groupChallengeMemberRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;
    @Autowired
    DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    @Autowired
    FocusSessionRepository focusSessionRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 30;
    /** 참가비 차감 후 잔액 — 참가 시점에 이미 STAKE 만큼 빠져 있는 상태를 재현한다. */
    private static final int BALANCE_AFTER_STAKE = 70;

    /**
     * 정산 대상은 "기준일 미만"이다 — session_date 는 기준일보다 앞선 날짜여야 배치가 집어간다.
     * 실제 시계 기준 동적 날짜(GROMO-1411): settle 이 24h 데드라인(N21)을 최우선으로 보므로 고정
     * 과거 날짜면 전부 자동 환불로 빠진다. 어제 회차는 언제 실행해도 "그레이스 경과 + 24h 이내"다.
     */
    private final LocalDate today = LocalDate.now(KST);
    private final LocalDate sessionDate = today.minusDays(1);

    private Group group;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> configs = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<DailyFocusStat> focusStats = new ArrayList<>();
    private final List<DailyScreenTimeStat> screenTimeStats = new ArrayList<>();
    private final List<GroupChallengeMember> reports = new ArrayList<>();
    private final List<FocusSession> focusSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
    }

    @AfterEach
    void tearDown() {
        // FK 역순. 다른 테스트 클래스는 @Transactional 롤백이라 여기 남은 행이 곧 오염이다.
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        betSessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(betSessions);
        groupChallengeBetRepository.deleteAll(configs);
        groupChallengeMemberRepository.deleteAll(reports);
        focusSessionRepository.deleteAll(focusSessions);
        dailyFocusStatRepository.deleteAll(focusStats);
        dailyScreenTimeStatRepository.deleteAll(screenTimeStats);
        challenges.forEach(c -> {
            groupChallengeDurationRepository.findById(c.getId())
                    .ifPresent(groupChallengeDurationRepository::delete);
            groupChallengeWindowRepository.findById(c.getId())
                    .ifPresent(groupChallengeWindowRepository::delete);
        });
        groupChallengeRepository.deleteAll(challenges);
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        users.forEach(u -> userScreenTimeSettingsRepository.findById(u.getId())
                .ifPresent(userScreenTimeSettingsRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        configs.clear();
        betSessions.clear();
        challenges.clear();
        focusStats.clear();
        screenTimeStats.clear();
        reports.clear();
        focusSessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User stakedUser(String nickname) {
        return stakedUser(nickname, true);
    }

    /**
     * 참가비를 이미 낸 참가자. {@code screenTimePermissionGranted} 가 SCREEN_TIME 판정의 전제다
     * (GROMO-1280) — 권한이 없으면 커널이 그 유저를 미계측으로 보고, 정산은 FR-21 대로 미달성으로
     * 닫는다. 카드가 "—" 로 그리는 상태와 정확히 같은 답이다.
     */
    private User stakedUser(String nickname, boolean screenTimePermissionGranted) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(user.getId())
                .screenTimePermissionGranted(screenTimePermissionGranted)
                .build());
        users.add(user);
        return user;
    }

    private GroupChallenge challenge(MissionCategory category, MissionType type) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(category).type(type).build());
        challenges.add(saved);
        return saved;
    }

    /** 일 목표 챌린지(DURATION). */
    private GroupChallenge durationChallenge(MissionCategory category) {
        GroupChallenge saved = challenge(category, MissionType.DURATION);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).category(category).durationMinutes(GOAL_MINUTES).build());
        return saved;
    }

    /** 매일 09:00~12:00(KST) 창 + 창 내 목표 120분. */
    private GroupChallenge windowChallenge(MissionCategory category) {
        GroupChallenge saved = challenge(category, MissionType.TIME_WINDOW);
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(saved)
                .windowStart(LocalTime.parse("09:00"))
                .windowEnd(LocalTime.parse("12:00"))
                .durationMinutes(GOAL_MINUTES)
                .build());
        return saved;
    }

    private GroupChallengeBetSession openSession(GroupChallenge target) {
        return openSession(target, STAKE, GOAL_MINUTES);
    }

    /** 설정 + 회차(미션 스냅샷 박제)를 함께 만든다 — 2계층의 정산 대상 픽스처. */
    private GroupChallengeBetSession openSession(GroupChallenge target, int stake, Integer goalMinutes) {
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(target).stake(stake).enabled(true).build());
        configs.add(config);
        Instant closesAt = sessionDate.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config)
                        .group(group)
                        .challenge(target)
                        .sessionDate(sessionDate)
                        .stake(stake)
                        .goalMinutes(goalMinutes)
                        .missionCategory(target.getCategory())
                        .missionType(target.getType())
                        .status(GroupBetStatus.OPEN)
                        .startsAt(sessionDate.atStartOfDay(KST).toInstant())
                        .joinClosesAt(closesAt)
                        .closesAt(closesAt)
                        .settleAfter(closesAt)
                        .build());
        betSessions.add(session);
        return session;
    }

    private void join(GroupChallengeBetSession session, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    /** FOCUS × DURATION 판정 소스 — 일 집중 통계. */
    private void dailyFocus(User user, int minutes) {
        focusStats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(sessionDate).totalFocusSeconds(minutes * 60).build()));
    }

    /** SCREEN_TIME × DURATION 판정 소스 — 일 사용 통계. 행 자체를 안 만들면 "미보고"다. */
    private void dailyScreenTime(User user, int minutes) {
        screenTimeStats.add(dailyScreenTimeStatRepository.save(DailyScreenTimeStat.builder()
                .user(user).date(sessionDate).totalScreenTimeMinutes(minutes).build()));
    }

    /**
     * FOCUS × TIME_WINDOW 판정 소스 — 창 안에 통째로 들어가는 완료 세션.
     * 회차 날짜의 09:00 KST 시작으로 고정한다(창 09:00~12:00 안에 통째로 들어간다).
     */
    private void windowFocusSession(User user, int minutes) {
        Instant startedAt = sessionDate.atTime(9, 0).atZone(KST).toInstant();
        focusSessions.add(focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(startedAt)
                .endedAt(startedAt.plusSeconds(minutes * 60L))
                .status(FocusSessionStatus.COMPLETED)
                .build()));
    }

    /** SCREEN_TIME × TIME_WINDOW 판정 소스 — 클라가 올린 날짜별 창 사용분. 안 부르면 미보고다. */
    private void reportWindowUsage(GroupChallenge target, User user, int minutes) {
        reports.add(groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(target).user(user).usageDate(sessionDate).progressMinutes(minutes).build()));
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    private GroupBetStatus statusOf(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow().getStatus();
    }

    /** 목표 스냅샷(GROMO-1263) — 개설 시점 박제값. DB 재조회로 읽는다. */
    private Integer goalMinutesOf(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow().getGoalMinutes();
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBetSession session) {
        return groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(session.getId()));
    }

    // ── ① FOCUS × DURATION (현행 회귀) ───────────────────────────────────

    @Test
    @DisplayName("① FOCUS×DURATION — 일 집중 통계로 판정한다(회귀)")
    void settlesFocusDurationByDailyFocusStat() {
        User winner = stakedUser("달성");
        User loser = stakedUser("미달");
        GroupChallengeBetSession session = openSession(durationChallenge(MissionCategory.FOCUS));
        join(session, winner);
        join(session, loser);
        dailyFocus(winner, GOAL_MINUTES);
        dailyFocus(loser, GOAL_MINUTES - 1);

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.FOCUS);

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(balanceOf(winner)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(loser)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    // ── ② FOCUS × TIME_WINDOW ───────────────────────────────────────────

    @Test
    @DisplayName("② FOCUS×TIME_WINDOW — 창 클리핑 집계로 판정하고 5분 관용치가 적용된다")
    void settlesFocusWindowByClippedSessionsWithTolerance() {
        User inTolerance = stakedUser("관용치안");
        User outOfTolerance = stakedUser("관용치밖");
        GroupChallengeBetSession session = openSession(windowChallenge(MissionCategory.FOCUS));
        join(session, inTolerance);
        join(session, outOfTolerance);
        windowFocusSession(inTolerance, GOAL_MINUTES - 5);    // 115분 — 관용치로 달성
        windowFocusSession(outOfTolerance, GOAL_MINUTES - 6); // 114분 — 1분 차로 미달성

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.FOCUS);

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
        // 판정 근거(GROMO-1207)도 창 클리핑 집계값 그대로다 — 카드 진행률과 같은 소스라는 계약의 증거.
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(
                        tuple(inTolerance.getId(), true, STAKE * 2, GOAL_MINUTES - 5),
                        tuple(outOfTolerance.getId(), false, 0, GOAL_MINUTES - 6));
        // 창형의 목표 스냅샷 = 창 내 목표분 — 개설 시점 박제(GROMO-1263).
        assertThat(goalMinutesOf(session)).isEqualTo(GOAL_MINUTES);
    }

    @Test
    @DisplayName("② FOCUS×TIME_WINDOW — 창 밖 집중은 계수되지 않아 몰수될 수 있다")
    void forfeitsFocusWindowWhenFocusHappenedOutsideWindow() {
        User user = stakedUser("창밖집중");
        User peer = stakedUser("무기록동료");   // 2명 — 인원 미달 무산(N47)이 아니라 판정 경로를 태운다
        GroupChallengeBetSession session = openSession(windowChallenge(MissionCategory.FOCUS));
        join(session, user);
        join(session, peer);
        // 창(09:00~12:00 KST) 밖인 13:00 KST 에 3시간 집중 — 창 판정에는 0분이다.
        Instant outside = sessionDate.atTime(13, 0).atZone(KST).toInstant();
        focusSessions.add(focusSessionRepository.save(FocusSession.builder()
                .user(user).startedAt(outside).endedAt(outside.plusSeconds(3 * 3600L))
                .status(FocusSessionStatus.COMPLETED).build()));

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.FOCUS);

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.FORFEITED);
        assertThat(balanceOf(user)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    // ── ③ SCREEN_TIME × DURATION ────────────────────────────────────────

    @Test
    @DisplayName("③ SCREEN_TIME×DURATION — 사용분이 목표 이하면 달성, 초과면 미달성(방향 반전)")
    void settlesScreenTimeDurationByDailyUsage() {
        User under = stakedUser("이하");
        User over = stakedUser("초과");
        GroupChallengeBetSession session = openSession(durationChallenge(MissionCategory.SCREEN_TIME));
        join(session, under);
        join(session, over);
        dailyScreenTime(under, GOAL_MINUTES);        // 목표와 동일 = 달성(이하)
        dailyScreenTime(over, GOAL_MINUTES + 1);     // 1분 초과 = 미달성

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.SCREEN_TIME);

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(balanceOf(under)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(balanceOf(over)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("③ SCREEN_TIME×DURATION — 통계 행이 없으면(미보고) 미달성이다. 정산은 마감돼야 한다")
    void treatsMissingScreenTimeStatAsFailure() {
        User reported = stakedUser("보고함");
        User silent = stakedUser("미보고");
        GroupChallengeBetSession session = openSession(durationChallenge(MissionCategory.SCREEN_TIME));
        join(session, reported);
        join(session, silent);
        dailyScreenTime(reported, 10);
        // silent 은 통계 행 자체가 없다 — FOCUS 였다면 "0분"이라 달성이었을 값이다.

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.SCREEN_TIME);

        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved)
                .containsExactlyInAnyOrder(
                        tuple(reported.getId(), true),
                        tuple(silent.getId(), false));
        assertThat(balanceOf(reported)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
    }

    // ── ④ SCREEN_TIME × TIME_WINDOW ─────────────────────────────────────

    @Test
    @DisplayName("④ SCREEN_TIME×TIME_WINDOW — 날짜별 클라 보고값으로 판정하고, 미보고는 미달성이다")
    void settlesScreenTimeWindowByReportedUsage() {
        User under = stakedUser("이하보고");
        User over = stakedUser("초과보고");
        User silent = stakedUser("구바이너리");
        GroupChallenge challenge = windowChallenge(MissionCategory.SCREEN_TIME);
        GroupChallengeBetSession session = openSession(challenge);
        join(session, under);
        join(session, over);
        join(session, silent);
        reportWindowUsage(challenge, under, GOAL_MINUTES);
        reportWindowUsage(challenge, over, GOAL_MINUTES + 1);
        // silent 은 보고 자체가 없다 — 구 바이너리 참가자의 정상 상태이자 미달성이다.

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.SCREEN_TIME);

        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.SETTLED);
        // 판정 근거(GROMO-1207): 미보고(silent)는 0 이 아니라 null 로 남는다 — "0분 사용"과
        // "미계측"을 구분해야 앱이 '—' 를 그린다. FOCUS 무기록이 0 으로 확정되는 것과 다른 지점.
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getPayout,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(
                        tuple(under.getId(), true, STAKE * 3, GOAL_MINUTES),
                        tuple(over.getId(), false, 0, GOAL_MINUTES + 1),
                        tuple(silent.getId(), false, 0, null));
        assertThat(goalMinutesOf(session)).isEqualTo(GOAL_MINUTES);
    }

    @Test
    @DisplayName("④ SCREEN_TIME×TIME_WINDOW — 다른 날짜의 보고는 그날 회차 판정에 쓰이지 않는다")
    void ignoresReportsFromOtherDates() {
        User user = stakedUser("다른날보고");
        User peer = stakedUser("미보고동료");   // 2명 — 인원 미달 무산이 아니라 판정 경로를 태운다
        GroupChallenge challenge = windowChallenge(MissionCategory.SCREEN_TIME);
        GroupChallengeBetSession session = openSession(challenge);
        join(session, user);
        join(session, peer);
        reports.add(groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(challenge).user(user).usageDate(sessionDate.minusDays(1))
                .progressMinutes(10).build()));

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.SCREEN_TIME);

        // 회차 날짜의 보고가 없으니 미달성 → 승자 0명 몰수.
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.FORFEITED);
    }

    // ── 잔여 배분 방향 ───────────────────────────────────────────────────

    @Test
    @DisplayName("잔여는 SCREEN_TIME 에서 '가장 적게 쓴' 승자에게 간다 — FOCUS 와 방향이 반대")
    void remainderGoesToLowestUsageWinnerForScreenTime() {
        // 참가비 10 × 4명 = 팟 40, 승자 3명 → 13씩 + 나머지 1
        User least = stakedUser("최소사용");
        User middle = stakedUser("중간사용");
        User most = stakedUser("최다사용");
        User loser = stakedUser("초과");
        GroupChallengeBetSession session =
                openSession(durationChallenge(MissionCategory.SCREEN_TIME), 10, GOAL_MINUTES);
        join(session, least);
        join(session, middle);
        join(session, most);
        join(session, loser);
        dailyScreenTime(least, 10);
        dailyScreenTime(middle, 60);
        dailyScreenTime(most, GOAL_MINUTES);
        dailyScreenTime(loser, GOAL_MINUTES + 30);

        groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.SCREEN_TIME);

        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getPayout)
                .containsExactlyInAnyOrder(
                        tuple(least.getId(), 14),   // 13 + 나머지 1
                        tuple(middle.getId(), 13),
                        tuple(most.getId(), 13),
                        tuple(loser.getId(), 0));
        assertThat(participantsOf(session).stream()
                .mapToInt(GroupChallengeBetParticipant::getPayout).sum()).isEqualTo(40);
    }

    // ── 크론 2회 대상 분리 ───────────────────────────────────────────────

    @Test
    @DisplayName("01:00 배치(FOCUS)는 스크린타임 회차를 건드리지 않고, 12:00 배치가 그것만 정산한다")
    void splitsTargetsByCategory() {
        User focusUser = stakedUser("포커스");
        User focusPeer = stakedUser("포커스동료");
        User screenUser = stakedUser("스크린타임");
        User screenPeer = stakedUser("스크린동료");
        GroupChallengeBetSession focusSession = openSession(durationChallenge(MissionCategory.FOCUS));
        join(focusSession, focusUser);
        join(focusSession, focusPeer);
        dailyFocus(focusUser, GOAL_MINUTES);
        GroupChallengeBetSession screenSession =
                openSession(durationChallenge(MissionCategory.SCREEN_TIME));
        join(screenSession, screenUser);
        join(screenSession, screenPeer);
        dailyScreenTime(screenUser, 10);
        dailyScreenTime(screenPeer, GOAL_MINUTES + 1);

        GroupBetSettlementSummaryResponse focusRun =
                groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.FOCUS);

        assertThat(focusRun.targetCount()).isEqualTo(1);
        assertThat(statusOf(focusSession)).isEqualTo(GroupBetStatus.SETTLED);
        // 스크린타임 회차는 아직 아침 보고를 기다리는 중이라 OPEN 그대로다.
        assertThat(statusOf(screenSession)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(screenUser)).isEqualTo(BALANCE_AFTER_STAKE);

        GroupBetSettlementSummaryResponse screenRun =
                groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.SCREEN_TIME);

        assertThat(screenRun.targetCount()).isEqualTo(1);
        assertThat(statusOf(screenSession)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(balanceOf(screenUser)).isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
    }

    @Test
    @DisplayName("카테고리를 안 주면 두 카테고리를 한 번에 정산한다 — 수동 트리거 기본값")
    void settlesBothCategoriesWhenNoFilter() {
        User focusUser = stakedUser("포커스");
        User focusPeer = stakedUser("포커스동료");
        User screenUser = stakedUser("스크린타임");
        User screenPeer = stakedUser("스크린동료");
        GroupChallengeBetSession focusSession = openSession(durationChallenge(MissionCategory.FOCUS));
        join(focusSession, focusUser);
        join(focusSession, focusPeer);
        dailyFocus(focusUser, GOAL_MINUTES);
        GroupChallengeBetSession screenSession =
                openSession(durationChallenge(MissionCategory.SCREEN_TIME));
        join(screenSession, screenUser);
        join(screenSession, screenPeer);
        dailyScreenTime(screenUser, 10);
        dailyScreenTime(screenPeer, GOAL_MINUTES + 1);

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(Instant.now(), null);

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.settledCount()).isEqualTo(2);
        assertThat(statusOf(focusSession)).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(statusOf(screenSession)).isEqualTo(GroupBetStatus.SETTLED);
    }

    // ── 상세 유실 방어 ───────────────────────────────────────────────────

    @Test
    @DisplayName("목표 스냅샷도 창 목표분도 없는 회차는 정산 불가로 롤백된다 — OPEN 에 남고 실패로 집계")
    void failsWhenWindowGoalMissing() {
        User user = stakedUser("목표유실");
        User peer = stakedUser("목표유실동료");   // 2명 — 인원 미달 무산이 아니라 판정 경로에서 터진다
        GroupChallenge broken = challenge(MissionCategory.FOCUS, MissionType.TIME_WINDOW);
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(broken)
                .windowStart(LocalTime.parse("09:00"))
                .windowEnd(LocalTime.parse("12:00"))
                .durationMinutes(null)
                .build());
        // goalMinutes null — V39 백필 이전 이력을 재현(스냅샷 폴백도 CTI 목표도 없다).
        GroupChallengeBetSession session = openSession(broken, STAKE, null);
        join(session, user);
        join(session, peer);

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.FOCUS);

        assertThat(summary.failedCount()).isEqualTo(1);
        assertThat(statusOf(session)).isEqualTo(GroupBetStatus.OPEN);
        assertThat(balanceOf(user)).isEqualTo(BALANCE_AFTER_STAKE);
    }

    // ── 참가자 0명 회차 (GROMO-1404 · N52) ───────────────────────────────

    @Test
    @DisplayName("참가자 0명 회차는 UNUSED 로 닫힌다 — 지급·환불 없이, 결과 상태(VOIDED 등)가 아니다")
    void closesEmptySessionAsUnused() {
        GroupChallengeBetSession empty = openSession(durationChallenge(MissionCategory.FOCUS));

        GroupBetSettlementSummaryResponse summary =
                groupBetSettlementService.settleDueBets(Instant.now(), MissionCategory.FOCUS);

        assertThat(statusOf(empty)).isEqualTo(GroupBetStatus.UNUSED);
        // 지급·환불 버킷에 잡히지 않는다 — 요약은 스킵으로 센다.
        assertThat(summary.settledCount()).isZero();
        assertThat(summary.forfeitedCount()).isZero();
        assertThat(summary.skippedCount()).isEqualTo(1);
    }
}
