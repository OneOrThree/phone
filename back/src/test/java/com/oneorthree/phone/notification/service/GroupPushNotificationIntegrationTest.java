package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
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
 * 두 푸시 트리거의 <b>발송 판정</b> 통합 테스트 — 실 DB + ci 프로파일의 NoOp 포트.
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

    @Autowired
    BetResultNotificationService betResultNotificationService;
    @Autowired
    ChallengeWindowEndNotificationService challengeWindowEndNotificationService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
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
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.SCREEN_TIME)
                .type(MissionType.TIME_WINDOW)
                .build());
        // 창 Instant 는 UTC 시각(time-of-day)만 의미를 갖고, 날짜 D 의 실제 창은 D(KST)에 얹는다.
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(challenge)
                .windowStartAt(Instant.EPOCH.plusSeconds(LocalTime.of(9, 0).toSecondOfDay()))
                .windowEndAt(Instant.EPOCH.plusSeconds(LocalTime.of(12, 0).toSecondOfDay()))
                .durationMinutes(60)
                .build());
        return challenge;
    }

    private GroupChallengeBet settledBet(GroupBetStatus status) {
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        return groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(challenge)
                .creatorUser(winner)
                .stake(50)
                .betDate(DAY.minusDays(1))
                .status(status)
                .settledAt(NOW.minusSeconds(3600))
                .build());
    }

    private void participant(GroupChallengeBet bet, User user, Boolean achieved, Integer payout) {
        GroupChallengeBetParticipant saved = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
        saved.recordSettlement(Boolean.TRUE.equals(achieved), payout == null ? 0 : payout);
    }

    private List<NotificationSentLog> logsOf(String type, User... users) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                type, List.of(users).stream().map(User::getId).toList(), NOW.minusSeconds(86_400));
    }

    @Test
    @DisplayName("정산 결과 푸시 — 참가자 전원에게 1회, 재실행은 dedup 으로 0건 발송")
    void betResultSendsOnceAndDedupsOnRerun() {
        GroupChallengeBet bet = settledBet(GroupBetStatus.SETTLED);
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
        GroupChallengeBet bet = settledBet(GroupBetStatus.FORFEITED);
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
        GroupChallengeBet bet = settledBet(GroupBetStatus.SETTLED);
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
                challengeWindowEndNotificationService.sendWindowEndNotifications(NOW);
        assertThat(first.sentCount()).isEqualTo(2);
        assertThat(logsOf(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END, winner, loser))
                .hasSize(2)
                .allSatisfy(sentLog ->
                        assertThat(sentLog.getTargetUserId()).isEqualTo(challenge.getId()));

        PushDispatchSummaryResponse second =
                challengeWindowEndNotificationService.sendWindowEndNotifications(NOW);
        assertThat(second.sentCount()).isZero();
        assertThat(second.dedupedCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("창 종료 푸시 — 창이 끝나기 전에는 대상 0건")
    void windowEndSkipsBeforeWindowCloses() {
        screenTimeWindowChallenge();

        PushDispatchSummaryResponse summary = challengeWindowEndNotificationService
                .sendWindowEndNotifications(DAY.atTime(11, 30).atZone(KST).toInstant());

        assertThat(summary.targetCount()).isZero();
        assertThat(logsOf(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END, winner, loser)).isEmpty();
    }

    @Test
    @DisplayName("창 종료 푸시 — 포커스 창형 챌린지는 대상이 아니다(스크린타임 전용)")
    void windowEndIgnoresFocusWindowChallenge() {
        GroupChallenge focusWindow = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.TIME_WINDOW)
                .build());
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(focusWindow)
                .windowStartAt(Instant.EPOCH.plusSeconds(LocalTime.of(9, 0).toSecondOfDay()))
                .windowEndAt(Instant.EPOCH.plusSeconds(LocalTime.of(12, 0).toSecondOfDay()))
                .durationMinutes(60)
                .build());

        PushDispatchSummaryResponse summary =
                challengeWindowEndNotificationService.sendWindowEndNotifications(NOW);

        assertThat(summary.targetCount()).isZero();
    }

    @Test
    @DisplayName("정산 결과 푸시 — CANCELED 내기는 결과가 아니라 발송 대상에서 빠진다")
    void betResultIgnoresCanceledBet() {
        GroupChallengeBet canceled = settledBet(GroupBetStatus.CANCELED);
        participant(canceled, winner, null, null);

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

        challengeWindowEndNotificationService.sendWindowEndNotifications(NOW);

        assertThat(notificationSentLogRepository.findByTypeAndUserIdInSince(
                NotificationSentLog.TYPE_CHALLENGE_WINDOW_END,
                List.of(otherGroupUserId), NOW.minusSeconds(86_400))).isEmpty();
    }
}
