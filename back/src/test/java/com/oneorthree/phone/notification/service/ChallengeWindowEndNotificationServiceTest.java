package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.service.WindowFocusAggregator;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 창 종료 감지의 <b>경계</b>와 dedup 단위 테스트.
 *
 * <p>{@link WindowFocusAggregator} 는 목이 아니라 실물을 쓴다 — 창 경계 해석(KST 앵커·자정 걸침)이
 * 진행률·정산과 같은 소스여야 한다는 것이 계약이라, 목으로 흉내 내면 그 정합을 못 지킨다.
 */
@ExtendWith(MockitoExtension.class)
class ChallengeWindowEndNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final UUID GROUP_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeRepository groupChallengeRepository;
    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;

    /**
     * 서비스는 테스트마다 새로 조립한다 — {@code @InjectMocks} 로는 {@link WindowFocusAggregator} 까지
     * 목이 되어 창 경계 해석이 실물과 갈라진다. 집계기는 창 경계 계산에 리포지터리를 쓰지 않으므로
     * 의존성은 null 로 둔다.
     */
    private ChallengeWindowEndNotificationService service() {
        return new ChallengeWindowEndNotificationService(
                groupChallengeRepository,
                groupChallengeWindowRepository,
                groupMemberRepository,
                userNotificationSettingsRepository,
                notificationSentLogRepository,
                pushNotificationService,
                new WindowFocusAggregator(null));
    }

    private static Group group() {
        return Group.builder().id(GROUP_ID).name("그룹").build();
    }

    private static GroupChallenge challenge() {
        return GroupChallenge.builder()
                .id(UUID.randomUUID())
                .group(group())
                .category(MissionCategory.SCREEN_TIME)
                .type(MissionType.TIME_WINDOW)
                .status(GroupChallengeStatus.ACTIVE)
                .build();
    }

    /** 창 시각은 UTC time-of-day 로 저장된다(WindowFocusAggregator.timeOfDay 와 같은 기준). */
    private static GroupChallengeWindow window(GroupChallenge challenge, LocalTime start, LocalTime end) {
        return GroupChallengeWindow.builder()
                .challengeId(challenge.getId())
                .challenge(challenge)
                .windowStartAt(Instant.EPOCH.plusSeconds(start.toSecondOfDay()))
                .windowEndAt(Instant.EPOCH.plusSeconds(end.toSecondOfDay()))
                .durationMinutes(60)
                .build();
    }

    private static User user(UUID id) {
        return User.builder().id(id).nickname("유저").deviceToken("token-" + id).build();
    }

    private void givenChallenge(GroupChallenge challenge, GroupChallengeWindow window) {
        given(groupChallengeRepository.findActiveByCategoryAndType(
                GroupChallengeStatus.ACTIVE, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW))
                .willReturn(List.of(challenge));
        given(groupChallengeWindowRepository.findByChallengeIdIn(anyCollection()))
                .willReturn(List.of(window));
    }

    private void givenMembers(GroupChallenge challenge, User... users) {
        given(groupMemberRepository.findByGroup(challenge.getGroup())).willReturn(
                List.of(users).stream()
                        .map(user -> GroupMember.builder().id(UUID.randomUUID())
                                .group(challenge.getGroup()).user(user).build())
                        .toList());
    }

    private void givenNoSentLogs() {
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END), anyList(), any()))
                .willReturn(List.of());
    }

    private void givenNoSettings() {
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.<UserNotificationSettings>of());
    }

    /** 창 09:00~12:00(KST) 인 챌린지 + 그 창이 방금 끝난 시각(12:05 KST). */
    private static Instant kst(int year, int month, int day, int hour, int minute) {
        return java.time.LocalDate.of(year, month, day)
                .atTime(hour, minute).atZone(KST).toInstant();
    }

    private static LocalTime utcTimeOf(int kstHour, int kstMinute) {
        // 저장 시각은 UTC time-of-day 이고 창 해석은 그 시각을 KST 날짜에 얹는다 —
        // 즉 "09:00 창" 은 저장값도 09:00 이다(WindowFocusAggregator 주석의 단일 기준).
        return LocalTime.of(kstHour, kstMinute);
    }

    @Test
    @DisplayName("창 종료가 직전 15분 안에 지났으면 그룹원 전원에게 발송한다")
    void sendsWhenWindowJustEnded() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, utcTimeOf(9, 0), utcTimeOf(12, 0)));
        User first = user(UUID.randomUUID());
        User second = user(UUID.randomUUID());
        givenMembers(challenge, first, second);
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.sentCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("창이 아직 안 끝났으면 대상 0건 — 그룹원 조회조차 하지 않는다")
    void skipsWhenWindowStillOpen() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, utcTimeOf(9, 0), utcTimeOf(12, 0)));

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 11, 59));

        assertThat(summary.targetCount()).isZero();
        verify(groupMemberRepository, never()).findByGroup(any());
    }

    @Test
    @DisplayName("종료 후 한참 지난 창(감지 폭 밖)은 발송하지 않는다 — 뒤늦은 푸시 방지")
    void skipsLongEndedWindow() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, utcTimeOf(9, 0), utcTimeOf(12, 0)));

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 13, 0));

        assertThat(summary.targetCount()).isZero();
    }

    @Test
    @DisplayName("자정을 걸치는 창(23:00~01:00)은 어제 시작분의 종료를 오늘 새벽에 잡는다")
    void detectsMidnightCrossingWindow() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, utcTimeOf(23, 0), utcTimeOf(1, 0)));
        User member = user(UUID.randomUUID());
        givenMembers(challenge, member);
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 1, 10));

        assertThat(summary.sentCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 날 이미 보낸 유저는 dedup — 15분마다 다시 돌아도 재발송하지 않는다")
    void dedupsWithinSameDay() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, utcTimeOf(9, 0), utcTimeOf(12, 0)));
        User member = user(UUID.randomUUID());
        givenMembers(challenge, member);
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END), anyList(), any()))
                .willReturn(List.of(NotificationSentLog.builder()
                        .userId(member.getId())
                        .type(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END)
                        .targetUserId(challenge.getId())
                        .sentAt(kst(2026, 8, 2, 12, 1))
                        .build()));

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        assertThat(summary.dedupedCount()).isEqualTo(1);
        assertThat(summary.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("다른 챌린지의 발송 이력은 dedup 대상이 아니다 — targetUserId 로 가른다")
    void dedupIsScopedToChallenge() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, utcTimeOf(9, 0), utcTimeOf(12, 0)));
        User member = user(UUID.randomUUID());
        givenMembers(challenge, member);
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END), anyList(), any()))
                .willReturn(List.of(NotificationSentLog.builder()
                        .userId(member.getId())
                        .type(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END)
                        .targetUserId(UUID.randomUUID())
                        .sentAt(kst(2026, 8, 2, 9, 0))
                        .build()));
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        assertThat(summary.sentCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("문구는 승패를 담지 않고, payload 에 딥링크·type·groupId 가 실린다")
    void composesResultCheckMessage() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, utcTimeOf(9, 0), utcTimeOf(12, 0)));
        User member = user(UUID.randomUUID());
        givenMembers(challenge, member);
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(any(), any(), captor.capture(), any());
        PushMessage message = captor.getValue();
        assertThat(message.title()).isEqualTo("챌린지가 끝났어요!");
        assertThat(message.body()).isEqualTo("결과를 확인해보세요");
        assertThat(message.link()).isEqualTo("gromo://group?g=" + GROUP_ID);
        assertThat(message.data()).containsEntry("type", "CHALLENGE_WINDOW_END")
                .containsEntry("groupId", GROUP_ID.toString());
    }

    @Test
    @DisplayName("활성 스크린타임 창형 챌린지가 없으면 창 조회조차 하지 않는다")
    void returnsEmptyWhenNoActiveChallenges() {
        given(groupChallengeRepository.findActiveByCategoryAndType(
                GroupChallengeStatus.ACTIVE, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW))
                .willReturn(List.of());

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        assertThat(summary.targetCount()).isZero();
        verify(groupChallengeWindowRepository, never()).findByChallengeIdIn(anyCollection());
    }
}
