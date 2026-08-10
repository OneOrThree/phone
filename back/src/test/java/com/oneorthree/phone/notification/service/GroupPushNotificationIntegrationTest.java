package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 그룹 챌린지 푸시 트리거들의 <b>발송 판정</b> 통합 테스트 — 실 DB + ci 프로파일의 NoOp 포트.
 *
 * <p>단위 테스트가 목으로 고정한 규칙(문구·경계·dedup)이 실제 스키마·쿼리 위에서도 성립하는지를 본다.
 * 핵심은 "재실행하면 0건 발송" 이다 — dedup 소스가 {@code notification_sent_logs} 뿐이라 조회 쿼리가
 * 조금이라도 어긋나면 매 크론마다 유저에게 같은 푸시가 다시 간다.
 *
 * <p>시각은 실행 시각과 겹치지 않는 과거로 고정한다 — 다른 테스트가 남긴 최근 정산 건이 48시간
 * 조회창에 딸려 들어오지 않게 하기 위함이다. quiet hours(기본 23–07 KST)를 피해 정오로 잡는다.
 */
class GroupPushNotificationIntegrationTest extends RepositoryTestBase {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DAY = LocalDate.of(2026, 6, 1);
    /** 창 09:00~12:00 이 막 끝난 직후(KST 12:05) — 정산 결과 푸시의 발송 시각으로도 쓴다. */
    private static final Instant NOW = DAY.atTime(12, 5).atZone(KST).toInstant();
    /**
     * 일 목표 마감 푸시의 발송 시각 — <b>내일</b> 09:00(KST). 마감 판정이 "회차가 끝난 뒤에 만들어진
     * 챌린지는 제외" 라서, 픽스처의 created_at(실제 저장 시각 = 지금)보다 회차 마감선이 뒤여야 한다.
     * 고정 과거 시각인 {@link #NOW} 로는 이 조건을 만들 수 없다.
     */
    private static final Instant DURATION_NOW =
            LocalDate.now(KST).plusDays(1).atTime(9, 0).atZone(KST).toInstant();
    /**
     * 창 종료 푸시의 발송 시각 — <b>내일</b> 12:05(KST). 창형에도 같은 판정이 생겼다(@codex 리뷰):
     * 창이 끝난 뒤에 만들어진 챌린지·그 뒤에 가입한 멤버는 그 회차에 참여한 적이 없어 대상이 아니다.
     * 픽스처의 created_at 은 실제 저장 시각(=지금)이라, 고정 과거인 {@link #NOW} 로는 창 종료가
     * created_at 보다 앞서 버려 대상이 0건이 된다. {@link #DURATION_NOW} 와 같은 이유다.
     */
    private static final Instant WINDOW_NOW =
            LocalDate.now(KST).plusDays(1).atTime(12, 5).atZone(KST).toInstant();
    /** 자정 걸침 dedup 검증용 — 창 20:40~23:40 이 끝난 직후(내일 23:45 KST). */
    private static final Instant WINDOW_LATE_NOW =
            LocalDate.now(KST).plusDays(1).atTime(23, 45).atZone(KST).toInstant();

    @Autowired
    BetResultNotificationService betResultNotificationService;
    @Autowired
    ChallengeWindowEndNotificationService challengeWindowEndNotificationService;
    @Autowired
    ChallengeDurationEndNotificationService challengeDurationEndNotificationService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    NotificationSentLogRepository notificationSentLogRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Autowired
    UserRepository userRepository;

    private Group group;
    private User winner;
    private User loser;

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("푸시그룹").build());
        winner = member("이긴사람");
        loser = member("진사람");
    }

    private User member(String nickname) {
        User user = userRepository.save(User.builder()
                .nickname(nickname).isGuest(false).deviceToken("token-" + nickname).build());
        groupMemberRepository.save(GroupMember.builder().group(group).user(user).build());
        return user;
    }

    private GroupChallenge screenTimeWindowChallenge() {
        return screenTimeWindowChallenge(LocalTime.of(9, 0), LocalTime.of(12, 0));
    }

    private GroupChallenge screenTimeWindowChallenge(LocalTime start, LocalTime end) {
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.SCREEN_TIME)
                .type(MissionType.TIME_WINDOW)
                .build());
        // 창 Instant 는 KST 벽시계 시각(time-of-day)만 의미를 갖고(GROMO-1100), 날짜 D 의 실제 창은 D(KST)에 얹는다.
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(challenge)
                .windowStart(start)
                .windowEnd(end)
                .durationMinutes(60)
                .build());
        return challenge;
    }

    /** 일 목표형(DURATION) 챌린지 — 목표가 있어야 마감 푸시 대상이다. */
    private GroupChallenge durationChallenge() {
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(challenge)
                .category(MissionCategory.FOCUS)
                .durationMinutes(60)
                .build());
        return challenge;
    }

    private GroupChallengeBetSession settledBet(GroupBetStatus status) {
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(challenge)
                .stake(50)
                .enabled(true)
                .build());
        return groupChallengeBetSessionRepository.save(GroupChallengeBetSession.builder()
                .bet(config)
                .group(group)
                .challenge(challenge)
                .sessionDate(DAY.minusDays(1))
                .stake(50)
                .goalMinutes(60)
                .missionCategory(MissionCategory.FOCUS)
                .missionType(MissionType.DURATION)
                .status(status)
                .startsAt(DAY.minusDays(1).atStartOfDay(KST).toInstant())
                .joinClosesAt(DAY.atStartOfDay(KST).toInstant())
                .closesAt(DAY.atStartOfDay(KST).toInstant())
                .settleAfter(DAY.atStartOfDay(KST).toInstant())
                .settledAt(NOW.minusSeconds(3600))
                .build());
    }

    private void participant(GroupChallengeBetSession session, User user, Boolean achieved, Integer payout) {
        GroupChallengeBetParticipant saved = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
        // 푸시 발송에는 정산 근거(progressMinutes)가 필요 없다 — 스냅샷 이전 정산 행과 같은 null 로 둔다.
        saved.recordSettlement(Boolean.TRUE.equals(achieved), payout == null ? 0 : payout, null);
    }

    private List<NotificationSentLog> logsOf(String type, User... users) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                type, List.of(users).stream().map(User::getId).toList(), NOW.minusSeconds(86_400));
    }

    @Test
    @DisplayName("정산 결과 푸시 — 참가자 전원에게 1회, 재실행은 dedup 으로 0건 발송")
    void betResultSendsOnceAndDedupsOnRerun() {
        GroupChallengeBetSession bet = settledBet(GroupBetStatus.SETTLED);
        participant(bet, winner, true, 100);
        participant(bet, loser, false, 0);

        PushDispatchSummaryResponse first = betResultNotificationService.sendBetResultNotifications(NOW);
        assertThat(first.targetCount()).isEqualTo(2);
        assertThat(first.sentCount()).isEqualTo(2);
        assertThat(first.dedupedCount()).isZero();
        assertThat(logsOf(NotificationSentLog.TYPE_BET_RESULT, winner, loser))
                .hasSize(2)
                .allSatisfy(sentLog -> assertThat(sentLog.getTargetUserId()).isEqualTo(bet.getId()));

        PushDispatchSummaryResponse second = betResultNotificationService.sendBetResultNotifications(NOW);
        assertThat(second.sentCount()).isZero();
        assertThat(second.dedupedCount()).isEqualTo(2);
        assertThat(logsOf(NotificationSentLog.TYPE_BET_RESULT, winner, loser)).hasSize(2);
    }

    @Test
    @DisplayName("정산 결과 푸시 — 알림을 끈 유저는 발송·기록 모두 없다")
    void betResultSkipsNotificationDisabledUser() {
        userNotificationSettingsRepository.save(UserNotificationSettings.builder()
                .userId(loser.getId()).notificationEnabled(false).build());
        GroupChallengeBetSession bet = settledBet(GroupBetStatus.FORFEITED);
        participant(bet, winner, false, 0);
        participant(bet, loser, false, 0);

        PushDispatchSummaryResponse summary = betResultNotificationService.sendBetResultNotifications(NOW);

        assertThat(summary.sentCount()).isEqualTo(1);
        assertThat(summary.skippedCount()).isEqualTo(1);
        assertThat(logsOf(NotificationSentLog.TYPE_BET_RESULT, winner, loser))
                .singleElement()
                .satisfies(sentLog -> assertThat(sentLog.getUserId()).isEqualTo(winner.getId()));
    }

    @Test
    @DisplayName("정산 결과 푸시 — quiet hours 경계: 06:59 는 미발송·무기록, 07:00 은 발송된다")
    void betResultRespectsQuietHoursBoundary() {
        GroupChallengeBetSession bet = settledBet(GroupBetStatus.SETTLED);
        participant(bet, winner, true, 100);

        PushDispatchSummaryResponse duringQuiet = betResultNotificationService
                .sendBetResultNotifications(DAY.atTime(6, 59).atZone(KST).toInstant());
        assertThat(duringQuiet.sentCount()).isZero();
        assertThat(duringQuiet.skippedCount()).isEqualTo(1);
        assertThat(logsOf(NotificationSentLog.TYPE_BET_RESULT, winner)).isEmpty();

        // 기본 구간은 [23:00, 07:00) — 07:00 정각은 발송 허용이다(PushNotificationService 계약).
        PushDispatchSummaryResponse afterQuiet = betResultNotificationService
                .sendBetResultNotifications(DAY.atTime(7, 0).atZone(KST).toInstant());
        assertThat(afterQuiet.sentCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("창 종료 푸시 — 그룹원 전원에게 1회, 재실행은 dedup 으로 0건 발송")
    void windowEndSendsOnceAndDedupsOnRerun() {
        GroupChallenge challenge = screenTimeWindowChallenge();

        PushDispatchSummaryResponse first =
                challengeWindowEndNotificationService.sendWindowEndNotifications(WINDOW_NOW);
        assertThat(first.sentCount()).isEqualTo(2);
        assertThat(logsOf(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END, winner, loser))
                .hasSize(2)
                .allSatisfy(sentLog ->
                        assertThat(sentLog.getTargetUserId()).isEqualTo(challenge.getId()));

        PushDispatchSummaryResponse second =
                challengeWindowEndNotificationService.sendWindowEndNotifications(WINDOW_NOW);
        assertThat(second.sentCount()).isZero();
        assertThat(second.dedupedCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("창 종료 푸시 — 감지 틱이 자정을 걸쳐도 dedup 이 유지된다(23:40 종료)")
    void windowEndDedupsAcrossMidnightTicks() {
        // 종료 23:40 은 감지 폭(30분) 때문에 23:45 틱과 00:00 틱 두 번 잡힌다 — 두 틱이 KST 날짜를
        // 가르므로, dedup 구간을 "당일 00:00" 으로만 끊으면 자정 뒤 틱이 전원에게 재발송한다.
        // 기본 quiet hours(23–07)가 가리는 시간대라, 커스텀 야간모드(01–06)를 켠 유저로 재현한다.
        List.of(winner, loser).forEach(user -> userNotificationSettingsRepository.save(
                UserNotificationSettings.builder()
                        .userId(user.getId())
                        .nightModeEnabled(true)
                        .nightStartTime(LocalTime.of(1, 0))
                        .nightEndTime(LocalTime.of(6, 0))
                        .build()));
        screenTimeWindowChallenge(LocalTime.of(20, 40), LocalTime.of(23, 40));

        PushDispatchSummaryResponse beforeMidnight = challengeWindowEndNotificationService
                .sendWindowEndNotifications(WINDOW_LATE_NOW);
        assertThat(beforeMidnight.sentCount()).isEqualTo(2);

        PushDispatchSummaryResponse afterMidnight = challengeWindowEndNotificationService
                .sendWindowEndNotifications(WINDOW_LATE_NOW.plus(java.time.Duration.ofMinutes(20)));
        assertThat(afterMidnight.sentCount()).isZero();
        assertThat(afterMidnight.dedupedCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("창 종료 푸시 — 창이 끝나기 전에는 대상 0건")
    void windowEndSkipsBeforeWindowCloses() {
        screenTimeWindowChallenge();

        PushDispatchSummaryResponse summary = challengeWindowEndNotificationService
                .sendWindowEndNotifications(WINDOW_NOW.minus(java.time.Duration.ofMinutes(35)));

        assertThat(summary.targetCount()).isZero();
        assertThat(logsOf(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END, winner, loser)).isEmpty();
    }

    @Test
    @DisplayName("창 종료 푸시 — 포커스 창형도 대상이고, 같은 그룹의 동시 종료는 1건으로 묶인다")
    void windowEndCoversFocusWindowAndCollapsesPerGroup() {
        GroupChallenge screenTimeWindow = screenTimeWindowChallenge();
        GroupChallenge focusWindow = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.TIME_WINDOW)
                .build());
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(focusWindow)
                .windowStart(LocalTime.of(10, 0))
                .windowEnd(LocalTime.of(12, 0))
                .durationMinutes(60)
                .build());

        PushDispatchSummaryResponse summary =
                challengeWindowEndNotificationService.sendWindowEndNotifications(WINDOW_NOW);

        // 발송 단위는 (유저 × 그룹) — 두 챌린지가 같이 끝나도 유저당 푸시는 1건이다.
        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.sentCount()).isEqualTo(2);
        // 이력은 그 푸시가 대변한 챌린지 전부에 남는다 — 다음 틱이 나머지 한 건으로 다시 보내지 않도록.
        assertThat(logsOf(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END, winner, loser))
                .hasSize(4)
                .extracting(NotificationSentLog::getTargetUserId)
                .containsOnly(screenTimeWindow.getId(), focusWindow.getId());
    }

    @Test
    @DisplayName("일 목표 마감 푸시 — 어제 회차가 끝난 챌린지로 그룹원 전원에게 1회, 재실행은 dedup")
    void durationEndSendsOnceAndDedupsOnRerun() {
        GroupChallenge challenge = durationChallenge();

        PushDispatchSummaryResponse first =
                challengeDurationEndNotificationService.sendDurationEndNotifications(DURATION_NOW);
        assertThat(first.sentCount()).isEqualTo(2);
        assertThat(logsOf(NotificationSentLog.TYPE_CHALLENGE_ENDED, winner, loser))
                .hasSize(2)
                .allSatisfy(sentLog ->
                        assertThat(sentLog.getTargetUserId()).isEqualTo(challenge.getId()));

        PushDispatchSummaryResponse second =
                challengeDurationEndNotificationService.sendDurationEndNotifications(DURATION_NOW);
        assertThat(second.sentCount()).isZero();
        assertThat(second.dedupedCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("일 목표 마감 푸시 — 창형 챌린지는 대상이 아니다(창 종료 크론이 맡는다)")
    void durationEndIgnoresWindowChallenge() {
        screenTimeWindowChallenge();

        PushDispatchSummaryResponse summary =
                challengeDurationEndNotificationService.sendDurationEndNotifications(DURATION_NOW);

        assertThat(summary.targetCount()).isZero();
        assertThat(logsOf(NotificationSentLog.TYPE_CHALLENGE_ENDED, winner, loser)).isEmpty();
    }

    @Test
    @DisplayName("정산 결과 푸시 — UNUSED·VOIDED 회차는 결과가 아니라 발송 대상에서 빠진다(N52)")
    void betResultIgnoresUnusedAndVoidedSessions() {
        GroupChallengeBetSession unused = settledBet(GroupBetStatus.UNUSED);
        GroupChallengeBetSession voided = settledBet(GroupBetStatus.VOIDED);
        participant(voided, winner, null, null);

        PushDispatchSummaryResponse summary = betResultNotificationService.sendBetResultNotifications(NOW);

        assertThat(summary.targetCount()).isZero();
        assertThat(logsOf(NotificationSentLog.TYPE_BET_RESULT, winner, loser)).isEmpty();
    }

    /** 다른 테스트가 남긴 데이터에 걸려 넘어지지 않도록, 이 클래스가 만든 그룹만 본다는 사실을 고정. */
    @Test
    @DisplayName("픽스처 격리 — 이 테스트의 그룹원만 발송 대상이다")
    void onlyOwnGroupMembersAreTargeted() {
        UUID otherGroupUserId = userRepository.save(User.builder()
                .nickname("남").isGuest(false).deviceToken("token-남").build()).getId();
        screenTimeWindowChallenge();

        challengeWindowEndNotificationService.sendWindowEndNotifications(WINDOW_NOW);

        assertThat(notificationSentLogRepository.findByTypeAndUserIdInSince(
                NotificationSentLog.TYPE_CHALLENGE_WINDOW_END,
                List.of(otherGroupUserId), NOW.minusSeconds(86_400))).isEmpty();
    }
}
