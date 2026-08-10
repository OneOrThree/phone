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
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 이벤트 기반 조기 정산 회귀(GROMO-1268, N11·FR-23) — 집중 기록 도착 트랜잭션의 개인 승리 확정과
 * {@code AFTER_COMMIT} 전원 확정 검사 → {@code settle(EARLY)} 연쇄를 실 DB 로 고정한다.
 *
 * <p>확정은 <b>FOCUS 회차에만</b> 건다 — 같은 날짜 SCREEN_TIME 회차는 건드리지 않는다(값이 하루
 * 종일 늘어나는 지표라 조기 불가역 확정이 성립하지 않는다). 확정 자체는 불가역이다.
 */
class GroupBetEarlyWinIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetEarlyWinConfirmer groupBetEarlyWinConfirmer;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    GroupRepository groupRepository;
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
    DailyFocusStatRepository dailyFocusStatRepository;
    @Autowired
    FocusSessionRepository focusSessionRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 30;
    private static final int BALANCE_AFTER_STAKE = 70;

    private Group group;
    private TransactionTemplate inTransaction;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> configs = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<DailyFocusStat> stats = new ArrayList<>();
    private final List<FocusSession> focusSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        // 집중 세션 저장 트랜잭션에 편승하는 실제 배선을 재현한다 — AFTER_COMMIT 리스너는
        // 이 템플릿의 커밋 직후(같은 스레드)에 돈다.
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
        dailyFocusStatRepository.deleteAll(stats);
        focusSessionRepository.deleteAll(focusSessions);
        challenges.forEach(c -> {
            groupChallengeDurationRepository.findById(c.getId())
                    .ifPresent(groupChallengeDurationRepository::delete);
            groupChallengeWindowRepository.findById(c.getId())
                    .ifPresent(groupChallengeWindowRepository::delete);
        });
        groupChallengeRepository.deleteAll(challenges);
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        configs.clear();
        betSessions.clear();
        challenges.clear();
        stats.clear();
        focusSessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User stakedUser(String nickname) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        users.add(user);
        return user;
    }

    private GroupChallenge durationChallenge(MissionCategory category) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(category).type(MissionType.DURATION).build());
        challenges.add(saved);
        // category 는 V36 이후 NOT NULL — 복합 FK 가 부모 챌린지 카테고리와의 일치를 강제한다.
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).category(category).durationMinutes(GOAL_MINUTES).build());
        return saved;
    }

    /** 09:00~12:00(KST) 창 + 창 내 목표 챌린지. */
    private GroupChallenge windowChallenge() {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.TIME_WINDOW).build());
        challenges.add(saved);
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(saved)
                // V35(GROMO-1406) 이후 창 시각은 KST 벽시계 LocalTime 이다 — Instant 앵커 변환 불요.
                .windowStart(LocalTime.of(9, 0))
                .windowEnd(LocalTime.of(12, 0))
                .durationMinutes(GOAL_MINUTES)
                .build());
        return saved;
    }

    private GroupChallengeBetSession session(GroupChallenge target, LocalDate sessionDate,
            Instant joinClosesAt, Instant closesAt, Instant settleAfter) {
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(target).stake(STAKE).enabled(true).build());
        configs.add(config);
        boolean windowed = target.getType() == MissionType.TIME_WINDOW;
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config).group(group).challenge(target)
                        .sessionDate(sessionDate).stake(STAKE).goalMinutes(GOAL_MINUTES)
                        .missionCategory(target.getCategory())
                        .missionType(target.getType())
                        .windowStart(windowed ? LocalTime.of(9, 0) : null)
                        .windowEnd(windowed ? LocalTime.of(12, 0) : null)
                        .status(GroupBetStatus.OPEN)
                        .startsAt(joinClosesAt)
                        .joinClosesAt(joinClosesAt).closesAt(closesAt).settleAfter(settleAfter)
                        .build());
        betSessions.add(saved);
        return saved;
    }

    private GroupChallengeBetParticipant join(GroupChallengeBetSession session, User user) {
        return groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    private GroupChallengeBetParticipant reload(GroupChallengeBetParticipant participant) {
        return groupChallengeBetParticipantRepository.findById(participant.getId()).orElseThrow();
    }

    // ── 테스트 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("FOCUS 회차만 개인 승리를 즉시 확정한다 — 같은 날짜 SCREEN_TIME 회차는 건드리지 않는다")
    void confirmsFocusOnlyAndIsIrreversible() {
        LocalDate today = LocalDate.now(KST);
        Instant midnight = today.plusDays(1).atStartOfDay(KST).toInstant();
        User user = stakedUser("달성자");
        User peer = stakedUser("동료");

        GroupChallengeBetSession focusSession = session(durationChallenge(MissionCategory.FOCUS),
                today, midnight, midnight, midnight.plus(Duration.ofHours(1)));
        GroupChallengeBetParticipant mine = join(focusSession, user);
        join(focusSession, peer);
        GroupChallengeBetSession screenSession = session(
                durationChallenge(MissionCategory.SCREEN_TIME),
                today, midnight, midnight, midnight.plus(Duration.ofHours(12)));
        GroupChallengeBetParticipant screenMine = join(screenSession, user);
        // 오늘 집중 목표를 채웠다 — 판정 소스(일 집중 통계) 기준.
        stats.add(dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(today).totalFocusSeconds(GOAL_MINUTES * 60).build()));

        inTransaction.executeWithoutResult(tx ->
                groupBetEarlyWinConfirmer.confirmWins(user, List.of(today)));

        GroupChallengeBetParticipant confirmed = reload(mine);
        assertThat(confirmed.getAchieved()).isTrue();
        assertThat(confirmed.getProgressMinutes()).isEqualTo(GOAL_MINUTES);
        // 조기 확정 시각 박제(V42, LLD §1.1) — confirmWin 순간의 Instant 가 함께 저장된다.
        assertThat(confirmed.getAchievedAt()).isNotNull();
        // SCREEN_TIME 은 조기 확정 대상이 아니다 — 하루가 끝나야 판정할 수 있는 지표다.
        assertThat(reload(screenMine).getAchieved()).isNull();
        // 하루형은 참가 마감(자정) 전이라 조기 정산으로 이어지지 않는다 — 회차는 OPEN 그대로.
        assertThat(groupChallengeBetSessionRepository.findById(focusSession.getId()).orElseThrow()
                .getStatus()).isEqualTo(GroupBetStatus.OPEN);

        // 불가역 + 멱등 — 다시 불러도 이미 확정된 행은 대상에서 빠진다(변화 없음).
        inTransaction.executeWithoutResult(tx ->
                groupBetEarlyWinConfirmer.confirmWins(user, List.of(today)));
        assertThat(reload(mine).getAchieved()).isTrue();
    }

    @Test
    @DisplayName("참가 마감 이후 마지막 확정이 커밋되면 AFTER_COMMIT 연쇄로 EARLY 정산까지 간다(그레이스 우회)")
    void lastConfirmationTriggersEarlySettlementAfterCommit() {
        LocalDate today = LocalDate.now(KST);
        Instant now = Instant.now();
        User first = stakedUser("선확정");
        User last = stakedUser("마지막확정");

        // 창형 — 참가 마감(창 시작)은 지났고 settle_after(창 끝+30분)는 미래인 회차.
        GroupChallengeBetSession session = session(windowChallenge(), today,
                now.minus(Duration.ofHours(2)), now.plus(Duration.ofMinutes(30)),
                now.plus(Duration.ofHours(1)));
        GroupChallengeBetParticipant firstJoin = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder()
                        .session(session).user(first).achieved(true).progressMinutes(GOAL_MINUTES)
                        .build());
        GroupChallengeBetParticipant lastJoin = join(session, last);
        // 마지막 확정자의 창 내 완료 집중 세션 — 창(오늘 09:00~12:00)에 통째로 들어간다.
        Instant windowStart = today.atTime(9, 0).atZone(KST).toInstant();
        focusSessions.add(focusSessionRepository.save(FocusSession.builder()
                .user(last)
                .status(FocusSessionStatus.COMPLETED)
                .startedAt(windowStart)
                .endedAt(windowStart.plusSeconds(GOAL_MINUTES * 60L))
                .build()));

        // 집중 기록 도착 트랜잭션 재현 — 커밋 직후 리스너가 전원 확정을 보고 EARLY 정산을 태운다.
        inTransaction.executeWithoutResult(tx ->
                groupBetEarlyWinConfirmer.confirmWins(last, List.of(today)));

        GroupChallengeBetSession settled =
                groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow();
        assertThat(settled.getStatus()).isEqualTo(GroupBetStatus.SETTLED);
        // 전원 승자 — 팟 균등 분배. 조기 확정의 진행분도 정산 시점 최종값으로 다시 재였다.
        assertThat(reload(firstJoin).getPayout()).isEqualTo(STAKE);
        assertThat(reload(lastJoin).getPayout()).isEqualTo(STAKE);
        assertThat(reload(lastJoin).getAchieved()).isTrue();
        // achieved_at 은 조기 확정 전용(LLD §1.1) — confirmWin 을 지난 참가자만 갖고,
        // 정산이 판정한 참가자(사전 세팅 행)는 null 그대로다(시각 축은 회차 settled_at).
        assertThat(reload(lastJoin).getAchievedAt()).isNotNull();
        assertThat(reload(firstJoin).getAchievedAt()).isNull();
    }
}
