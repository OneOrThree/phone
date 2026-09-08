package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeMember;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.domain.SettleTrigger;
import com.oneorthree.phone.group.dto.ChallengeMemberProgressResponse;
import com.oneorthree.phone.group.dto.GroupBetSessionParticipantResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/**
 * <b>판정 단일화 회귀</b>(GROMO-1280) — 카드 진행률·정산·조기 확정이 {@link GroupBetJudge} 라는
 * 같은 커널을 지나는지 실 DB 로 고정한다. 단위 테스트는 각 층을 따로 보므로 "두 층이 같은 답을
 * 내는가"는 여기서만 드러난다.
 *
 * <p>이 파일이 막는 회귀는 실제로 있었던 어긋남이다:
 * <ul>
 *   <li>카드는 스크린타임 권한 철회 멤버를 진행률에서 빼 "판정 불가(—)"로 그렸는데, 정산은 같은
 *       필터가 없어 <b>철회 전에 쌓인 통계</b>로 승패를 확정했다 — 화면과 지급이 갈렸다</li>
 *   <li>같은 카드 안에서도 하루형에만 권한 필터가 있고 창형에는 없었다</li>
 *   <li>회차 판정이 목표분만 스냅샷을 쓰고 창 시각은 살아 있는 챌린지에서 읽었다</li>
 * </ul>
 *
 * <p>{@code @Transactional} 을 붙이지 않는다 — 정산은 회차 단위 커밋({@code REQUIRES_NEW})이다.
 * 만든 행은 {@code @AfterEach} 에서 FK 역순으로 지운다.
 */
class GroupBetJudgeUnificationIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupChallengeService groupChallengeService;
    @Autowired
    GroupBetService groupBetService;
    @Autowired
    GroupBetSettler groupBetSettler;
    @Autowired
    GroupBetEarlyWinConfirmer groupBetEarlyWinConfirmer;
    @Autowired
    PlatformTransactionManager transactionManager;
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
    private static final int BALANCE_AFTER_STAKE = 70;

    /** 어제 회차 — 그레이스는 지났고 24h 데드라인(N21)은 아직인 유일하게 안전한 창이다. */
    private final LocalDate today = LocalDate.now(KST);
    private final LocalDate sessionDate = today.minusDays(1);

    private Group group;
    private TransactionTemplate inTransaction;

    private final List<User> users = new ArrayList<>();
    private final List<GroupMember> members = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<GroupChallengeBet> configs = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();
    private final List<DailyFocusStat> focusStats = new ArrayList<>();
    private final List<DailyScreenTimeStat> screenTimeStats = new ArrayList<>();
    private final List<GroupChallengeMember> reports = new ArrayList<>();
    private final List<FocusSession> focusSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("판정단일화").build());
        inTransaction = new TransactionTemplate(transactionManager);
    }

    @AfterEach
    void tearDown() {
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
        groupMemberRepository.deleteAll(members);
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
        members.clear();
        challenges.clear();
        configs.clear();
        betSessions.clear();
        focusStats.clear();
        screenTimeStats.clear();
        reports.clear();
        focusSessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    /** 그룹 멤버 + 지갑 + 스크린타임 권한 설정을 한 번에 만든다. */
    private User member(String nickname, boolean screenTimePermissionGranted) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(user.getId())
                .screenTimePermissionGranted(screenTimePermissionGranted)
                .build());
        members.add(groupMemberRepository.save(GroupMember.builder()
                .user(user).group(group)
                .role(GroupMemberRole.MEMBER)
                .build()));
        users.add(user);
        return user;
    }

    private GroupChallenge durationChallenge(MissionCategory category) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(category).type(MissionType.DURATION)
                .status(GroupChallengeStatus.ACTIVE).build());
        challenges.add(saved);
        // category 는 V36 의 카테고리별 목표 상한 CHECK·복합 FK 가 요구하는 비정규화 복사다(NOT NULL).
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).category(category).durationMinutes(GOAL_MINUTES).build());
        return saved;
    }

    /** 창형 챌린지 — CTI 상세의 창 시각을 인자로 받아 "스냅샷과 다른 값"을 만들 수 있게 한다. */
    private GroupChallenge windowChallenge(MissionCategory category, String start, String end,
            int goalMinutes) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(category).type(MissionType.TIME_WINDOW)
                .status(GroupChallengeStatus.ACTIVE).build());
        challenges.add(saved);
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(saved)
                .windowStart(LocalTime.parse(start))
                .windowEnd(LocalTime.parse(end))
                .durationMinutes(goalMinutes)
                .build());
        return saved;
    }

    private GroupChallengeBetSession openSession(GroupChallenge challenge) {
        return openSession(challenge, GOAL_MINUTES, null, null);
    }

    /** 설정 + 회차. 창 시각 스냅샷을 명시적으로 넣을 수 있다(박제 우선 검증용). */
    private GroupChallengeBetSession openSession(GroupChallenge challenge, Integer goalMinutes,
            LocalTime windowStart, LocalTime windowEnd) {
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).stake(STAKE).enabled(true).build());
        configs.add(config);
        Instant closesAt = sessionDate.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config)
                        .group(group)
                        .challenge(challenge)
                        .sessionDate(sessionDate)
                        .stake(STAKE)
                        .goalMinutes(goalMinutes)
                        .missionCategory(challenge.getCategory())
                        .missionType(challenge.getType())
                        .windowStart(windowStart)
                        .windowEnd(windowEnd)
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

    private void dailyScreenTime(User user, LocalDate date, int minutes) {
        screenTimeStats.add(dailyScreenTimeStatRepository.save(DailyScreenTimeStat.builder()
                .user(user).date(date).totalScreenTimeMinutes(minutes).build()));
    }

    private void dailyFocus(User user, LocalDate date, int minutes) {
        focusStats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(date).totalFocusSeconds(minutes * 60).build()));
    }

    private void reportWindowUsage(GroupChallenge challenge, User user, LocalDate date, int minutes) {
        reports.add(groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(challenge).user(user).usageDate(date).progressMinutes(minutes).build()));
    }

    /** 창 안에 통째로 들어가는 완료 집중 세션. */
    private void windowFocusSession(User user, LocalDate date, LocalTime start, int minutes) {
        Instant startedAt = date.atTime(start).atZone(KST).toInstant();
        focusSessions.add(focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(startedAt)
                .endedAt(startedAt.plusSeconds(minutes * 60L))
                .status(FocusSessionStatus.COMPLETED)
                .build()));
    }

    private ChallengeMemberProgressResponse cardRowOf(UUID challengeId, User viewer, User target,
            LocalDate date) {
        List<GroupChallengeResponse> cards =
                groupChallengeService.getChallenges(group.getId(), viewer.getId(), date);
        GroupChallengeResponse card = cards.stream()
                .filter(c -> c.getId().equals(challengeId))
                .findFirst()
                .orElseThrow();
        return card.getMemberProgress().stream()
                .filter(row -> row.getUserId().equals(target.getId()))
                .findFirst()
                .orElseThrow();
    }

    private List<GroupChallengeBetParticipant> participantsOf(GroupChallengeBetSession session) {
        return groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(session.getId()));
    }

    /** 카드의 <b>회차 참가자</b> 한 줄(bet.session.participants) — memberProgress 와는 다른 축이다. */
    private GroupBetSessionParticipantResponse betSessionRowOf(UUID challengeId, User viewer,
            User target, LocalDate date) {
        GroupChallengeResponse card =
                groupChallengeService.getChallenges(group.getId(), viewer.getId(), date).stream()
                        .filter(c -> c.getId().equals(challengeId))
                        .findFirst()
                        .orElseThrow();
        return card.getBet().getSession().getParticipants().stream()
                .filter(row -> row.getUserId().equals(target.getId()))
                .findFirst()
                .orElseThrow();
    }

    // ── ① 권한 철회 — 카드와 정산이 같은 답을 낸다 ─────────────────────────

    @Test
    @DisplayName("권한 철회 참가자: 카드가 '—' 면 정산도 미달성이다 — 잔존 통계로 승리하지 않는다")
    void revokedPermissionGivesSameAnswerOnCardAndSettlement() {
        // 철회자에게는 철회 전에 쌓인 통계(목표 이하)가 남아 있다 — 종전 정산은 이 값으로 승리를
        // 확정했고, 같은 순간 카드는 "판정 불가(—)"를 그렸다. 측정을 끄는 것이 이기는 길이 된다.
        User granted = member("권한동의", true);
        User revoked = member("권한철회", false);
        GroupChallenge challenge = durationChallenge(MissionCategory.SCREEN_TIME);
        GroupChallengeBetSession session = openSession(challenge);
        join(session, granted);
        join(session, revoked);
        dailyScreenTime(granted, sessionDate, GOAL_MINUTES - 10);
        dailyScreenTime(revoked, sessionDate, 5);   // 철회 직전까지 5분 — 그대로 재면 완승이다

        ChallengeMemberProgressResponse revokedRow =
                cardRowOf(challenge.getId(), granted, revoked, sessionDate);
        groupBetSettler.settle(session.getId(), SettleTrigger.CRON);

        // 카드: 미계측(—)
        assertThat(revokedRow.getProgressMinutes()).isNull();
        assertThat(revokedRow.getAchieved()).isNull();
        // 정산: 같은 미계측이 FR-21 로 미달성 확정. 근거 분도 null 로 남아 "0분 사용"과 구분된다.
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(
                        tuple(granted.getId(), true, GOAL_MINUTES - 10),
                        tuple(revoked.getId(), false, null));
        // 판돈은 전부 유일한 승자에게 — 철회자가 잔여 배분 1위(가장 적게 쓴 사람)로도 끼지 않는다
        assertThat(userWalletRepository.findById(granted.getId()).orElseThrow().getBalance())
                .isEqualTo(BALANCE_AFTER_STAKE + STAKE * 2);
        assertThat(userWalletRepository.findById(revoked.getId()).orElseThrow().getBalance())
                .isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("창형 SCREEN_TIME 도 같은 규칙 — 철회자의 잔존 보고값은 카드에서도 정산에서도 무시된다")
    void revokedPermissionAppliesToWindowedScreenTimeToo() {
        // 종전에는 하루형 카드에만 권한 필터가 있어, 같은 규칙이 창형에서 통째로 빠져 있었다.
        User granted = member("권한동의", true);
        User revoked = member("권한철회", false);
        GroupChallenge challenge =
                windowChallenge(MissionCategory.SCREEN_TIME, "09:00:00", "12:00:00", GOAL_MINUTES);
        GroupChallengeBetSession session = openSession(challenge);
        join(session, granted);
        join(session, revoked);
        reportWindowUsage(challenge, granted, sessionDate, GOAL_MINUTES - 10);
        reportWindowUsage(challenge, revoked, sessionDate, 5);

        ChallengeMemberProgressResponse revokedRow =
                cardRowOf(challenge.getId(), granted, revoked, sessionDate);
        groupBetSettler.settle(session.getId(), SettleTrigger.CRON);

        assertThat(revokedRow.getProgressMinutes()).isNull();
        assertThat(revokedRow.getAchieved()).isNull();
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved)
                .containsExactlyInAnyOrder(
                        tuple(granted.getId(), true),
                        tuple(revoked.getId(), false));
    }

    // ── ② 3상 규칙(§B7 · FR-15/16/21) 보존 ────────────────────────────────

    @Test
    @DisplayName("3상 보존 — FOCUS 무기록은 카드·정산 모두 0분/미달성, SCREEN_TIME 미계측만 '—'")
    void keepsThreeStateSemanticsAcrossCardAndSettlement() {
        User focusSilent = member("집중무기록", true);
        User peer = member("동료", true);
        GroupChallenge focusChallenge = durationChallenge(MissionCategory.FOCUS);
        GroupChallenge screenChallenge = durationChallenge(MissionCategory.SCREEN_TIME);
        GroupChallengeBetSession focusSession = openSession(focusChallenge);
        GroupChallengeBetSession screenSession = openSession(screenChallenge);
        join(focusSession, focusSilent);
        join(focusSession, peer);
        join(screenSession, focusSilent);
        join(screenSession, peer);
        dailyFocus(peer, sessionDate, GOAL_MINUTES);
        dailyScreenTime(peer, sessionDate, 10);
        // focusSilent 은 두 소스 모두 행이 없다 — FOCUS 는 "0분"이 사실이고 SCREEN_TIME 은 미계측이다.

        ChallengeMemberProgressResponse focusRow =
                cardRowOf(focusChallenge.getId(), peer, focusSilent, sessionDate);
        ChallengeMemberProgressResponse screenRow =
                cardRowOf(screenChallenge.getId(), peer, focusSilent, sessionDate);
        groupBetSettler.settle(focusSession.getId(), SettleTrigger.CRON);
        groupBetSettler.settle(screenSession.getId(), SettleTrigger.CRON);

        // 카드 — FOCUS 는 0분/미달성(값이 선다), SCREEN_TIME 은 null/판정 불가
        assertThat(focusRow.getProgressMinutes()).isZero();
        assertThat(focusRow.getAchieved()).isFalse();
        assertThat(screenRow.getProgressMinutes()).isNull();
        assertThat(screenRow.getAchieved()).isNull();

        // 정산 근거 — 같은 접기 규칙(displayMinutes)이므로 0 과 null 이 그대로 이어진다
        assertThat(participantsOf(focusSession).stream()
                .filter(p -> p.getUser().getId().equals(focusSilent.getId()))
                .findFirst().orElseThrow())
                .extracting(GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactly(false, 0);
        assertThat(participantsOf(screenSession).stream()
                .filter(p -> p.getUser().getId().equals(focusSilent.getId()))
                .findFirst().orElseThrow())
                .extracting(GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactly(false, null);
    }

    // ── ③ 조기 확정과 최종 정산이 같은 커널 ───────────────────────────────

    @Test
    @DisplayName("조기 확정과 최종 정산이 같은 커널·같은 관용치를 쓴다 — 창형 FOCUS 목표−5분 경계")
    void earlyConfirmationAndSettlementShareTheKernel() {
        // 창 목표 120분에 115분(= 목표 − 5분 관용치 경계)만 집중했다. 커널이 하나라면 조기 확정도
        // 최종 정산도 "달성"이고, 두 층이 갈리면 확정만 되고 정산이 뒤집거나 그 반대가 된다.
        User earlyWinner = member("조기확정", true);
        User peer = member("동료", true);
        GroupChallenge challenge =
                windowChallenge(MissionCategory.FOCUS, "09:00:00", "12:00:00", GOAL_MINUTES);
        GroupChallengeBetSession session = openSession(challenge);
        join(session, earlyWinner);
        join(session, peer);
        windowFocusSession(earlyWinner, sessionDate, LocalTime.of(9, 0), GOAL_MINUTES - 5);

        inTransaction.executeWithoutResult(status ->
                groupBetEarlyWinConfirmer.confirmWins(earlyWinner.getId(), List.of(sessionDate)));

        GroupChallengeBetParticipant confirmed = participantsOf(session).stream()
                .filter(p -> p.getUser().getId().equals(earlyWinner.getId()))
                .findFirst().orElseThrow();
        assertThat(confirmed.getAchieved()).isTrue();
        assertThat(confirmed.getProgressMinutes()).isEqualTo(GOAL_MINUTES - 5);

        // 카드도 같은 커널이라 같은 순간 "달성"이다.
        assertThat(cardRowOf(challenge.getId(), peer, earlyWinner, sessionDate).getAchieved()).isTrue();

        groupBetSettler.settle(session.getId(), SettleTrigger.CRON);
        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved)
                .containsExactlyInAnyOrder(
                        tuple(earlyWinner.getId(), true),
                        tuple(peer.getId(), false));
    }

    // ── ④ 회차 스냅샷이 판정 기준 ─────────────────────────────────────────

    @Test
    @DisplayName("회차 판정은 박제 스냅샷 기준 — 챌린지의 창 시각·목표가 달라도 회차는 개설 시점 값으로 잰다")
    void judgesBySessionSnapshotNotLiveChallenge() {
        // 챌린지 CTI 는 13:00~15:00 / 목표 30분인데, 회차 스냅샷은 09:00~12:00 / 목표 120분이다.
        // 집중은 09:00~11:00 에만 있다 — 스냅샷 기준이면 달성(120분), CTI 기준이면 0분 미달성이다.
        User participant = member("스냅샷참가자", true);
        User peer = member("동료", true);
        GroupChallenge challenge =
                windowChallenge(MissionCategory.FOCUS, "13:00:00", "15:00:00", 30);
        GroupChallengeBetSession session =
                openSession(challenge, GOAL_MINUTES, LocalTime.of(9, 0), LocalTime.of(12, 0));
        join(session, participant);
        join(session, peer);
        windowFocusSession(participant, sessionDate, LocalTime.of(9, 0), GOAL_MINUTES);

        groupBetSettler.settle(session.getId(), SettleTrigger.CRON);

        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved,
                        GroupChallengeBetParticipant::getProgressMinutes)
                .containsExactlyInAnyOrder(
                        tuple(participant.getId(), true, GOAL_MINUTES),
                        tuple(peer.getId(), false, 0));
    }

    @Test
    @DisplayName("스냅샷이 결손인 옛 회차만 챌린지 CTI 로 폴백한다 — 판정이 멈추지 않는다")
    void fallsBackToChallengeDetailWhenSnapshotIsMissing() {
        // V39 백필 이전(V29 미만) 이력은 goal_minutes·창 시각이 null 이다. 그 행도 정산은 돼야 한다.
        User participant = member("옛회차참가자", true);
        User peer = member("동료", true);
        GroupChallenge challenge =
                windowChallenge(MissionCategory.FOCUS, "09:00:00", "12:00:00", GOAL_MINUTES);
        GroupChallengeBetSession session = openSession(challenge, null, null, null);
        join(session, participant);
        join(session, peer);
        windowFocusSession(participant, sessionDate, LocalTime.of(9, 0), GOAL_MINUTES);

        groupBetSettler.settle(session.getId(), SettleTrigger.CRON);

        assertThat(participantsOf(session))
                .extracting(p -> p.getUser().getId(), GroupChallengeBetParticipant::getAchieved)
                .containsExactlyInAnyOrder(
                        tuple(participant.getId(), true),
                        tuple(peer.getId(), false));
    }

    // ── ⑤ 계정 탈퇴 박제 — 카드 명단과 정산이 같은 근거를 본다 (GROMO-1423 · codex) ──

    @Test
    @DisplayName("탈퇴로 통계가 사라진 달성자 — 카드 회차 명단과 정산 근거가 같은 값이다(0분/미달성으로 갈리지 않는다)")
    void erasedAchieverShowsSameFrozenEvidenceOnCardAndSettlement() {
        // 회차 시작 + 취소 마감 후 계정을 탈퇴하면 참가 행은 정산 대상으로 남고(FR-40) 통계만
        // nullify 된다. 카드가 통계를 다시 집계하면 달성자가 0분/미달성으로 접혀, 정산이 쓰는
        // 박제 결과와 명단이 어긋난다.
        User erased = member("탈퇴자", true);
        User peer = member("동료", true);
        GroupChallenge challenge = durationChallenge(MissionCategory.FOCUS);
        GroupChallengeBetSession session = openSession(challenge);
        join(session, erased);
        join(session, peer);
        dailyFocus(erased, sessionDate, GOAL_MINUTES + 40);
        dailyFocus(peer, sessionDate, GOAL_MINUTES + 10);

        // UserService.withdraw 와 같은 순서: 근거 박제 → 통계 nullify → 멤버십 이탈 → 소프트딜리트.
        groupBetService.freezeEvidenceForAccountErasure(erased);
        inTransaction.executeWithoutResult(status -> {
            dailyFocusStatRepository.nullifyUser(erased.getId());
            groupMemberRepository.findByUser(erased).forEach(GroupMember::leave);
            User row = userRepository.findById(erased.getId()).orElseThrow();
            row.setNickname(null);
            row.setDeleted(true);
        });

        // 카드는 정산 전에 읽는다 — 이 순간의 명단이 정산 결과와 같은 값이어야 한다.
        GroupBetSessionParticipantResponse cardRow =
                betSessionRowOf(challenge.getId(), peer, erased, sessionDate);
        assertThat(cardRow.getProgressMinutes()).isEqualTo(GOAL_MINUTES + 40);
        assertThat(cardRow.getAchieved()).isTrue();

        groupBetSettler.settle(session.getId(), SettleTrigger.CRON);

        GroupChallengeBetParticipant settled = participantsOf(session).stream()
                .filter(p -> p.getUser().getId().equals(erased.getId()))
                .findFirst().orElseThrow();
        // 직접 대조 — 정산이 쓴 값과 카드가 보여준 값이 같은 값이다.
        assertThat(settled.getProgressMinutes()).isEqualTo(cardRow.getProgressMinutes());
        assertThat(settled.getAchieved()).isEqualTo(cardRow.getAchieved());
    }
}
