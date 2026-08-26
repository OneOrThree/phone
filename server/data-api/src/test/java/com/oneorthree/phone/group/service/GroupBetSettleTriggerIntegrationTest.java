package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.domain.SettleTrigger;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
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

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 정산 단일 진입점 회귀(GROMO-1411·1413) — 트리거별 가드 순서를 실 DB 로 고정한다:
 * <ol>
 *   <li><b>24h 데드라인(N21)이 모든 트리거에서 최우선</b> — CRON·MANUAL·EARLY 어느 경로도
 *       데드라인을 우회해 지급으로 빠질 수 없다</li>
 *   <li>EARLY 는 그레이스({@code settle_after})를 우회하되 참가 마감·전원 확정을 락 안에서
 *       재검증한다(N32)</li>
 *   <li>CRON 은 창형 FOCUS 회차의 창 겹침 ACTIVE 집중 세션이 남아 있으면 틱을 스킵한다(N37) —
 *       SCREEN_TIME 창형에는 대기를 걸지 않는다</li>
 *   <li>인원 게이트: 0명 → UNUSED(N52), 1명 → VOIDED + 환불(N47 안전망)</li>
 *   <li>스캔 술어({@code findDue})는 백오프를 존중하되 24h 초과분은 백오프와 무관하게 집는다</li>
 * </ol>
 */
class GroupBetSettleTriggerIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetSettler groupBetSettler;
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
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
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

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> configs = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<FocusSession> focusSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
    }

    @AfterEach
    void tearDown() {
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        betSessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(betSessions);
        groupChallengeBetRepository.deleteAll(configs);
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
        // category 는 V36 이후 NOT NULL 비정규화 사본이다 — 복합 FK (challenge_id, category) 가
        // 부모와의 일치를 강제하므로 반드시 부모 챌린지와 같은 값을 넣는다.
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).category(category).durationMinutes(GOAL_MINUTES).build());
        return saved;
    }

    /** 09:00~12:00(KST) 창 + 창 내 목표 챌린지. */
    private GroupChallenge windowChallenge(MissionCategory category) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(category).type(MissionType.TIME_WINDOW).build());
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

    /** 시각 필드를 직접 제어하는 회차 픽스처 — 가드 순서를 시나리오별로 재현한다. */
    private GroupChallengeBetSession session(GroupChallenge target, LocalDate sessionDate,
            Instant joinClosesAt, Instant closesAt, Instant settleAfter) {
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(target).stake(STAKE).enabled(true).build());
        configs.add(config);
        boolean windowed = target.getType() == MissionType.TIME_WINDOW;
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config).group(group).challenge(target)
                        .sessionDate(sessionDate)
                        .stake(STAKE)
                        .goalMinutes(GOAL_MINUTES)
                        .missionCategory(target.getCategory())
                        .missionType(target.getType())
                        .windowStart(windowed ? LocalTime.of(9, 0) : null)
                        .windowEnd(windowed ? LocalTime.of(12, 0) : null)
                        .status(GroupBetStatus.OPEN)
                        .startsAt(joinClosesAt)
                        .joinClosesAt(joinClosesAt)
                        .closesAt(closesAt)
                        .settleAfter(settleAfter)
                        .build());
        betSessions.add(saved);
        return saved;
    }

    private GroupChallengeBetParticipant join(GroupChallengeBetSession session, User user) {
        return groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    /** 조기 확정(achieved=true)까지 끝난 참가 행 — EARLY 전원 확정 시나리오용. */
    private GroupChallengeBetParticipant confirmedJoin(GroupChallengeBetSession session, User user) {
        return groupChallengeBetParticipantRepository.save(GroupChallengeBetParticipant.builder()
                .session(session).user(user).achieved(true).progressMinutes(GOAL_MINUTES).build());
    }

    private GroupChallengeBetSession reload(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findById(session.getId()).orElseThrow();
    }

    private long refundsOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_REFUND).count();
    }

    private long payoutsOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_PAYOUT).count();
    }

    private int balanceOf(User user) {
        return userWalletRepository.findById(user.getId()).orElseThrow().getBalance();
    }

    // ── ① 24h 데드라인 — 전 트리거 공통 최우선 (N21) ─────────────────────

    @Test
    @DisplayName("24h 초과 회차는 CRON·MANUAL·EARLY 어느 트리거로 들어와도 지급 대신 전원 환불된다")
    void refundsPastDeadlineOnEveryTrigger() {
        Instant now = Instant.now();
        Instant expired = now.minus(Duration.ofHours(25));   // settle_after + 24h < now
        for (SettleTrigger trigger : SettleTrigger.values()) {
            User a = stakedUser("A-" + trigger);
            User b = stakedUser("B-" + trigger);
            GroupChallengeBetSession session = session(durationChallenge(MissionCategory.FOCUS),
                    LocalDate.now(KST).minusDays(2), expired, expired, expired);
            // b 는 달성 확정 상태 — 지급 경로로 빠지면 환불 대신 팟이 나간다(그걸 막는 게 N21).
            join(session, a);
            confirmedJoin(session, b);

            GroupBetSettler.SettleResult result = groupBetSettler.settle(session.getId(), trigger);

            assertThat(result).as("trigger=" + trigger)
                    .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.REFUNDED, true));
            GroupChallengeBetSession closed = reload(session);
            assertThat(closed.getStatus()).isEqualTo(GroupBetStatus.REFUNDED);
            assertThat(closed.getVoidReason()).isEqualTo(GroupBetVoidReason.REFUND_DEADLINE);
            // 사유가 응답 경계까지 살아 있어야 앱이 "달성자 0명 환불"과 구분한다(N55·③).
            assertThat(closed.getVoidReason()).isNotNull();
            // 전원 참가비 환불 — 지급(BET_PAYOUT)은 한 건도 없다.
            assertThat(refundsOf(a)).isEqualTo(1);
            assertThat(refundsOf(b)).isEqualTo(1);
            assertThat(payoutsOf(b)).isZero();
            assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
            assertThat(balanceOf(b)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);

            // 재실행 멱등 — status 가드가 걸러 환불이 반복되지 않는다.
            assertThat(groupBetSettler.settle(session.getId(), trigger).applied()).isFalse();
            assertThat(refundsOf(a)).isEqualTo(1);
        }
    }

    // ── ② EARLY — 그레이스 우회 + 락 안 재검증 (N11·N32) ──────────────────

    @Test
    @DisplayName("EARLY 는 settle_after 미경과라도 정산한다 — CRON 은 같은 회차꼴을 스킵한다(그레이스 우회)")
    void earlyBypassesGraceButCronDoesNot() {
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(KST);
        User a = stakedUser("확정A");
        User b = stakedUser("확정B");
        // 실효 참가 마감(브리지 = 창 종료)은 지났고 settle_after(창 끝+30분)는 아직 미래인 창형 회차.
        // 브리지 기간에는 창이 끝나야 참가가 닫히므로 EARLY 도 그 시점부터 발동한다(①).
        GroupChallengeBetSession earlySession = session(windowChallenge(MissionCategory.FOCUS),
                today, now.minus(Duration.ofHours(2)), now.minus(Duration.ofMinutes(5)),
                now.plus(Duration.ofMinutes(25)));
        confirmedJoin(earlySession, a);
        confirmedJoin(earlySession, b);

        // CRON 은 그레이스 가드에 걸려 아무것도 하지 않는다.
        assertThat(groupBetSettler.settle(earlySession.getId(), SettleTrigger.CRON).applied()).isFalse();
        assertThat(reload(earlySession).getStatus()).isEqualTo(GroupBetStatus.OPEN);

        // EARLY 는 그레이스를 우회해 즉시 정산한다 — 전원 확정이라 둘 다 승자, 팟 균등 분배.
        GroupBetSettler.SettleResult result = groupBetSettler.settle(earlySession.getId(), SettleTrigger.EARLY);

        assertThat(result).isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));
        assertThat(payoutsOf(a)).isEqualTo(1);
        assertThat(payoutsOf(b)).isEqualTo(1);
        assertThat(balanceOf(a)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(balanceOf(b)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
    }

    @Test
    @DisplayName("EARLY 재검증 — 참가 마감 전이거나 미확정 참가자가 있으면 락 안에서 스킵된다")
    void earlyRevalidatesJoinDeadlineAndFullConfirmationUnderLock() {
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(KST);

        // ⓐ 참가 마감 전 — 전원 확정이어도 아직 들어올 사람이 남아 있다.
        GroupChallengeBetSession beforeDeadline = session(windowChallenge(MissionCategory.FOCUS),
                today, now.plus(Duration.ofHours(1)), now.plus(Duration.ofHours(4)),
                now.plus(Duration.ofHours(5)));
        confirmedJoin(beforeDeadline, stakedUser("이른확정A"));
        confirmedJoin(beforeDeadline, stakedUser("이른확정B"));
        assertThat(groupBetSettler.settle(beforeDeadline.getId(), SettleTrigger.EARLY).applied()).isFalse();
        assertThat(reload(beforeDeadline).getStatus()).isEqualTo(GroupBetStatus.OPEN);

        // ⓑ 미확정 참가자 잔존 — 리스너의 낡은 "전원 확정" 판단을 락 안 재검증이 걸러낸다.
        GroupChallengeBetSession unconfirmedLeft = session(windowChallenge(MissionCategory.FOCUS),
                today, now.minus(Duration.ofHours(1)), now.plus(Duration.ofMinutes(30)),
                now.plus(Duration.ofHours(1)));
        confirmedJoin(unconfirmedLeft, stakedUser("확정됨"));
        join(unconfirmedLeft, stakedUser("막차참가"));
        assertThat(groupBetSettler.settle(unconfirmedLeft.getId(), SettleTrigger.EARLY).applied()).isFalse();
        assertThat(reload(unconfirmedLeft).getStatus()).isEqualTo(GroupBetStatus.OPEN);
    }

    @Test
    @DisplayName("EARLY 도 실효 마감(창 종료)을 본다 — 창 진행 중 전원 확정으로 회차를 조기에 닫지 않는다(①)")
    void earlyDoesNotSettleWhileLegacyJoinStillAllowed() {
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(KST);
        // 창은 시작(= 박제 join_closes_at 경과)했지만 아직 끝나지 않았다 — 구앱은 이 구간에도
        // 참가할 수 있다. 여기서 전원 확정이 회차를 닫으면 그 참가가 BET_CLOSED 로 거절된다.
        GroupChallengeBetSession running = session(windowChallenge(MissionCategory.FOCUS),
                today, now.minus(Duration.ofMinutes(30)), now.plus(Duration.ofHours(1)),
                now.plus(Duration.ofMinutes(90)));
        confirmedJoin(running, stakedUser("창중확정A"));
        confirmedJoin(running, stakedUser("창중확정B"));

        assertThat(groupBetSettler.settle(running.getId(), SettleTrigger.EARLY).applied()).isFalse();
        assertThat(reload(running).getStatus()).isEqualTo(GroupBetStatus.OPEN);

        // 창이 끝난 뒤에는 EARLY 가 그레이스(창 끝+30분)를 우회해 즉시 정산한다 — N32 는 그대로다.
        GroupChallengeBetSession finished = session(windowChallenge(MissionCategory.FOCUS),
                today, now.minus(Duration.ofHours(2)), now.minus(Duration.ofMinutes(5)),
                now.plus(Duration.ofMinutes(25)));
        confirmedJoin(finished, stakedUser("창종료확정A"));
        confirmedJoin(finished, stakedUser("창종료확정B"));

        assertThat(groupBetSettler.settle(finished.getId(), SettleTrigger.EARLY))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.SETTLED, true));
    }

    // ── ③ 창형 FOCUS 정산 대기 (N37 · GROMO-1413) ────────────────────────

    @Test
    @DisplayName("FOCUS 창형 — 창 겹침 ACTIVE 세션이 남아 있으면 CRON 틱을 스킵하고, 사라지면 정산한다")
    void cronWaitsForActiveFocusSessionOverlappingWindow() {
        Instant now = Instant.now();
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);
        User running = stakedUser("집중중");
        User idle = stakedUser("대기");
        GroupChallengeBetSession session = session(windowChallenge(MissionCategory.FOCUS),
                yesterday,
                yesterday.atTime(9, 0).atZone(KST).toInstant(),
                yesterday.atTime(12, 0).atZone(KST).toInstant(),
                now.minus(Duration.ofHours(1)));
        join(session, running);
        join(session, idle);
        // 창(어제 09:00~12:00)을 걸쳐 아직 도는 ACTIVE 세션 — 완료 집계에 안 잡히는 진행분이다.
        FocusSession active = focusSessionRepository.save(FocusSession.builder()
                .user(running)
                .status(FocusSessionStatus.ACTIVE)
                .startedAt(yesterday.atTime(10, 0).atZone(KST).toInstant())
                .build());
        focusSessions.add(active);

        assertThat(groupBetSettler.settle(session.getId(), SettleTrigger.CRON).applied()).isFalse();
        assertThat(reload(session).getStatus()).isEqualTo(GroupBetStatus.OPEN);

        // 세션이 닫히면(여기서는 제거로 재현 — 자동 마감과 동치) 다음 틱이 정산한다.
        focusSessionRepository.delete(active);
        focusSessions.remove(active);
        GroupBetSettler.SettleResult result = groupBetSettler.settle(session.getId(), SettleTrigger.CRON);

        assertThat(result.applied()).isTrue();
        // 창 내 완료 세션이 없으니 전원 미달성 → 몰수. 대기 가드 해제가 검증 대상이다.
        assertThat(result.status()).isEqualTo(GroupBetStatus.FORFEITED);
    }

    @Test
    @DisplayName("SCREEN_TIME 창형 — 참가자가 집중 중이어도 대기하지 않는다(판정 소스가 무관하다)")
    void screenTimeWindowDoesNotWaitForActiveFocusSessions() {
        Instant now = Instant.now();
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);
        User running = stakedUser("집중중2");
        User idle = stakedUser("대기2");
        GroupChallengeBetSession session = session(windowChallenge(MissionCategory.SCREEN_TIME),
                yesterday,
                yesterday.atTime(9, 0).atZone(KST).toInstant(),
                yesterday.atTime(12, 0).atZone(KST).toInstant(),
                now.minus(Duration.ofHours(1)));
        join(session, running);
        join(session, idle);
        FocusSession active = focusSessionRepository.save(FocusSession.builder()
                .user(running)
                .status(FocusSessionStatus.ACTIVE)
                .startedAt(yesterday.atTime(10, 0).atZone(KST).toInstant())
                .build());
        focusSessions.add(active);

        GroupBetSettler.SettleResult result = groupBetSettler.settle(session.getId(), SettleTrigger.CRON);

        // 대기 없이 정산된다 — 미보고 전원이라 몰수지만, 핵심은 OPEN 에 머물지 않는다는 것이다.
        assertThat(result.applied()).isTrue();
        assertThat(result.status()).isEqualTo(GroupBetStatus.FORFEITED);
    }

    // ── ④ 인원 게이트 — 0명 UNUSED / 1명 VOIDED (N47·N52 · GROMO-1412) ────

    @Test
    @DisplayName("참가 마감 무산 — 0명은 UNUSED(돈 무변동), 1명은 VOIDED + 환불 1회, 2명은 건드리지 않는다")
    void closesShortSessionsAtJoinDeadline() {
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(KST);
        // 하루형은 참가 마감 = 회차 종료(익일 00:00)라 두 값이 같다 — 팩토리가 만드는 실제 형태다.
        // (창형의 두 값이 갈리는 브리지 케이스는 doesNotVoidWindowedSoloSessionBeforeLegacyJoinDeadline)
        Instant deadlinePassed = now.minus(Duration.ofMinutes(10));
        Instant future = now.plus(Duration.ofHours(3));
        GroupChallenge challenge = durationChallenge(MissionCategory.FOCUS);

        GroupChallengeBetSession empty = session(challenge, today, deadlinePassed, deadlinePassed, future);
        GroupChallengeBetSession solo = session(durationChallenge(MissionCategory.FOCUS),
                today, deadlinePassed, deadlinePassed, future);
        GroupChallengeBetSession pair = session(durationChallenge(MissionCategory.FOCUS),
                today, deadlinePassed, deadlinePassed, future);
        User alone = stakedUser("혼자");
        join(solo, alone);
        User p1 = stakedUser("둘중하나");
        User p2 = stakedUser("둘중둘");
        join(pair, p1);
        join(pair, p2);

        // 크론 스캔은 마감 지난 2명 미만 회차만 집는다.
        List<UUID> targets = groupChallengeBetSessionRepository
                .findOpenPastJoinDeadlineWithFewParticipants(Instant.now());
        assertThat(targets).contains(empty.getId(), solo.getId()).doesNotContain(pair.getId());

        assertThat(groupBetSettler.closeShortOrUnused(empty.getId()))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.UNUSED, true));
        assertThat(groupBetSettler.closeShortOrUnused(solo.getId()))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.VOIDED, true));
        assertThat(groupBetSettler.closeShortOrUnused(pair.getId()).applied()).isFalse();

        assertThat(reload(empty).getStatus()).isEqualTo(GroupBetStatus.UNUSED);
        assertThat(reload(empty).getVoidReason()).isNull();
        GroupChallengeBetSession voided = reload(solo);
        assertThat(voided.getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        assertThat(voided.getVoidReason()).isEqualTo(GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS);
        assertThat(reload(pair).getStatus()).isEqualTo(GroupBetStatus.OPEN);

        // 혼자 남은 참가자만 환불 1회 — 재실행해도 반복되지 않는다.
        assertThat(refundsOf(alone)).isEqualTo(1);
        assertThat(balanceOf(alone)).isEqualTo(BALANCE_AFTER_STAKE + STAKE);
        assertThat(groupBetSettler.closeShortOrUnused(solo.getId()).applied()).isFalse();
        assertThat(refundsOf(alone)).isEqualTo(1);
        // 참가 행에는 환불 근거가 남고 판정은 비어 있다(판정된 결과가 아니다).
        assertThat(groupChallengeBetParticipantRepository
                .findBySessionIdIn(List.of(solo.getId())))
                .singleElement()
                .satisfies(p -> {
                    assertThat(p.getAchieved()).isNull();
                    assertThat(p.getPayout()).isEqualTo(STAKE);
                });
    }

    @Test
    @DisplayName("창형 단독 참가 회차는 창 시작 직후 무산되지 않는다 — 브리지 참가 허용 시간(창 종료)까지 산다(④)")
    void doesNotVoidWindowedSoloSessionBeforeLegacyJoinDeadline() {
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(KST);
        // 창은 이미 시작(= 박제 join_closes_at 경과)했지만 아직 끝나지 않았다. 구앱 참가 가드
        // (requireWindowStillOpen)는 이 구간에도 두 번째 참가자를 받아 준다.
        GroupChallengeBetSession running = session(windowChallenge(MissionCategory.FOCUS),
                today, now.minus(Duration.ofMinutes(30)), now.plus(Duration.ofHours(1)),
                now.plus(Duration.ofMinutes(90)));
        User solo = stakedUser("창중단독");
        join(running, solo);

        // 스캔이 아직 집지 않는다 — 실효 참가 마감(창 종료)이 지나지 않았다.
        assertThat(groupChallengeBetSessionRepository
                .findOpenPastJoinDeadlineWithFewParticipants(Instant.now()))
                .doesNotContain(running.getId());
        // 건별 진입점도 같은 기준이라 스킵한다(스캔↔처리 기준 불일치 금지).
        assertThat(groupBetSettler.closeShortOrUnused(running.getId()).applied()).isFalse();
        assertThat(reload(running).getStatus()).isEqualTo(GroupBetStatus.OPEN);
        assertThat(refundsOf(solo)).isZero();

        // 창이 끝난 회차는 같은 조건에서 즉시 무산·환불된다(N47 의 본래 목적은 보존).
        GroupChallengeBetSession finished = session(windowChallenge(MissionCategory.FOCUS),
                today, now.minus(Duration.ofHours(3)), now.minus(Duration.ofMinutes(10)),
                now.plus(Duration.ofMinutes(20)));
        User lonely = stakedUser("창종료단독");
        join(finished, lonely);

        assertThat(groupChallengeBetSessionRepository
                .findOpenPastJoinDeadlineWithFewParticipants(Instant.now()))
                .contains(finished.getId());
        assertThat(groupBetSettler.closeShortOrUnused(finished.getId()))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.VOIDED, true));
        assertThat(refundsOf(lonely)).isEqualTo(1);
    }

    @Test
    @DisplayName("settle 본체의 인원 안전망 — 그레이스 경과 후에도 0명 UNUSED / 1명 VOIDED 로 닫힌다")
    void settleFallsBackToUnusedAndVoidBranches() {
        Instant now = Instant.now();
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);
        Instant past = now.minus(Duration.ofHours(1));

        GroupChallengeBetSession empty = session(durationChallenge(MissionCategory.FOCUS),
                yesterday, past, past, past);
        GroupChallengeBetSession solo = session(durationChallenge(MissionCategory.FOCUS),
                yesterday, past, past, past);
        User alone = stakedUser("혼자정산");
        join(solo, alone);

        assertThat(groupBetSettler.settle(empty.getId(), SettleTrigger.CRON))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.UNUSED, true));
        assertThat(groupBetSettler.settle(solo.getId(), SettleTrigger.CRON))
                .isEqualTo(new GroupBetSettler.SettleResult(GroupBetStatus.VOIDED, true));
        assertThat(refundsOf(alone)).isEqualTo(1);
        assertThat(reload(solo).getVoidReason())
                .isEqualTo(GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS);
    }

    // ── ⑤ 수동 배치 대상 — 회차별 settle_after 경과 (당일 회차 포함) ────────

    @Test
    @DisplayName("MANUAL 배치는 당일 창형 회차도 잡는다 — settle_after 경과가 선택 축이다(날짜 축 폐지)")
    void manualBatchPicksSameDayWindowedSession() {
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(KST);
        User a = stakedUser("당일A");
        User b = stakedUser("당일B");
        // 오늘 오전 창이 끝나고 그레이스(30분)까지 지난 회차 — 종전 날짜 축(session_date < today)
        // 선택으로는 내일까지 안 잡혀 24h 자동 환불로 흐를 수 있던 케이스다.
        GroupChallengeBetSession sameDay = session(windowChallenge(MissionCategory.FOCUS),
                today, now.minus(Duration.ofHours(3)), now.minus(Duration.ofHours(2)),
                now.minus(Duration.ofHours(1)));
        join(sameDay, a);
        join(sameDay, b);

        groupBetSettlementService.settleDueBets(Instant.now(), null);

        // 창 내 완료 세션이 없어 몰수지만, 핵심은 당일 회차가 대상으로 집혀 OPEN 을 벗어났다는 것.
        assertThat(reload(sameDay).getStatus()).isEqualTo(GroupBetStatus.FORFEITED);
    }

    @Test
    @DisplayName("MANUAL 배치도 settle_after 미도래 회차는 건드리지 않는다 — settle 내부 가드 이중 방어")
    void manualBatchLeavesNotYetDueSessionsOpen() {
        Instant now = Instant.now();
        GroupChallengeBetSession notDue = session(durationChallenge(MissionCategory.FOCUS),
                LocalDate.now(KST), now.plus(Duration.ofHours(1)), now.plus(Duration.ofHours(2)),
                now.plus(Duration.ofHours(3)));
        join(notDue, stakedUser("미도래A"));
        join(notDue, stakedUser("미도래B"));

        groupBetSettlementService.settleDueBets(Instant.now(), null);

        assertThat(reload(notDue).getStatus()).isEqualTo(GroupBetStatus.OPEN);
    }

    // ── ⑥ 스캔 술어 — 백오프 존중 + 24h 초과분 무시 불가 (GROMO-1411) ──────

    @Test
    @DisplayName("findDue — 백오프 미경과 회차는 빠지고, 24h 초과 회차는 백오프와 무관하게 집힌다")
    void findDueRespectsBackoffButNeverHidesDeadline() {
        Instant now = Instant.now();
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);
        Instant past = now.minus(Duration.ofHours(1));
        Instant expired = now.minus(Duration.ofHours(25));

        GroupChallengeBetSession dueNow = session(durationChallenge(MissionCategory.FOCUS),
                yesterday, past, past, past);
        GroupChallengeBetSession backedOff = session(durationChallenge(MissionCategory.FOCUS),
                yesterday, past, past, past);
        GroupChallengeBetSession expiredButBackedOff = session(durationChallenge(MissionCategory.FOCUS),
                LocalDate.now(KST).minusDays(2), expired, expired, expired);
        GroupChallengeBetSession notYetDue = session(durationChallenge(MissionCategory.FOCUS),
                LocalDate.now(KST), now.plus(Duration.ofHours(1)), now.plus(Duration.ofHours(1)),
                now.plus(Duration.ofHours(2)));

        // 실패 기록 — 시도 횟수 +1 과 다음 시도 시각이 함께 저장된다(detached 필드 변경으로는 불가).
        assertThat(groupChallengeBetSessionRepository
                .recordFailure(backedOff.getId(), now.plus(Duration.ofHours(1)), now)).isEqualTo(1);
        assertThat(groupChallengeBetSessionRepository
                .recordFailure(expiredButBackedOff.getId(), now.plus(Duration.ofHours(4)), now))
                .isEqualTo(1);
        assertThat(reload(backedOff).getSettleAttempts()).isEqualTo(1);

        List<UUID> due = groupChallengeBetSessionRepository
                .findDue(Instant.now(), Instant.now().minus(GroupBetSettler.REFUND_DEADLINE)).stream()
                .map(GroupChallengeBetSession::getId)
                .toList();

        assertThat(due).contains(dueNow.getId());
        // 백오프 미경과 — 이번 틱은 건너뛴다(장애 난 의존성을 5분마다 계속 때리지 않는다).
        assertThat(due).doesNotContain(backedOff.getId());
        // 단 24h 초과분은 백오프가 가리지 못한다 — 환불 데드라인은 시각에 걸린 약속이다(N21).
        assertThat(due).contains(expiredButBackedOff.getId());
        assertThat(due).doesNotContain(notYetDue.getId());
    }
}
