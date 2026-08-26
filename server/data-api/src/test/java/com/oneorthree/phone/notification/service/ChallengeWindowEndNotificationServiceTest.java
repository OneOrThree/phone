package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.domain.RepeatSchedule;
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

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
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
 * {@link ChallengeEndPushDispatcher} 도 실물이다 — 발송 단위(그룹당 1건)·dedup 이 이 서비스의
 * 동작 계약이라 목으로 걷어내면 검증할 것이 남지 않는다.
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
                new WindowFocusAggregator(null),
                new ChallengeEndPushDispatcher(
                        groupMemberRepository,
                        userNotificationSettingsRepository,
                        notificationSentLogRepository,
                        pushNotificationService));
    }

    private static Group group() {
        return Group.builder().id(GROUP_ID).name("그룹").build();
    }

    private static GroupChallenge challenge() {
        return challenge(MissionCategory.SCREEN_TIME);
    }

    private static GroupChallenge challenge(MissionCategory category) {
        return GroupChallenge.builder()
                .id(UUID.randomUUID())
                .group(group())
                .category(category)
                .type(MissionType.TIME_WINDOW)
                .status(GroupChallengeStatus.ACTIVE)
                .createdAt(Instant.EPOCH)
                .build();
    }

    /** 창 시각은 KST 벽시계 time-of-day 로 해석된다(WindowFocusAggregator.timeOfDay, GROMO-1100). */
    private static GroupChallengeWindow window(GroupChallenge challenge, LocalTime start, LocalTime end) {
        return GroupChallengeWindow.builder()
                .challengeId(challenge.getId())
                .challenge(challenge)
                .windowStart(start)
                .windowEnd(end)
                .durationMinutes(60)
                .build();
    }

    private static User user(UUID id) {
        return User.builder().id(id).nickname("유저").deviceToken("token-" + id).build();
    }

    private void givenChallenge(GroupChallenge challenge, GroupChallengeWindow window) {
        givenChallenges(List.of(challenge), List.of(window));
    }

    private void givenChallenges(List<GroupChallenge> challenges, List<GroupChallengeWindow> windows) {
        given(groupChallengeRepository.findActiveByType(
                GroupChallengeStatus.ACTIVE, MissionType.TIME_WINDOW))
                .willReturn(challenges);
        given(groupChallengeWindowRepository.findByChallengeIdIn(anyCollection()))
                .willReturn(windows);
    }

    private void givenMembers(GroupChallenge challenge, User... users) {
        givenMembersJoinedAt(challenge, Instant.EPOCH, users);
    }

    /** 가입 시각을 지정하는 오버로드 — 회차 종료 뒤 가입 판정(@codex 리뷰) 검증용. */
    private void givenMembersJoinedAt(GroupChallenge challenge, Instant joinedAt, User... users) {
        given(groupMemberRepository.findByGroupIdIn(anyCollection())).willReturn(
                Arrays.stream(users)
                        .map(user -> GroupMember.builder().id(UUID.randomUUID())
                                .group(challenge.getGroup()).user(user).createdAt(joinedAt).build())
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
        return LocalDate.of(year, month, day)
                .atTime(hour, minute).atZone(KST).toInstant();
    }

    private static LocalTime kstTimeOf(int kstHour, int kstMinute) {
        // 창 해석은 저장 Instant 의 KST 벽시계 시각을 KST 날짜에 얹는다(GROMO-1100) —
        // 즉 "09:00 창" 은 KST 09:00 이다(WindowFocusAggregator 주석의 단일 기준).
        return LocalTime.of(kstHour, kstMinute);
    }

    @Test
    @DisplayName("창 종료가 직전 15분 안에 지났으면 그룹원 전원에게 발송한다")
    void sendsWhenWindowJustEnded() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));
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
    @DisplayName("포커스 창형 챌린지도 대상이다 — 창 종료 감지는 카테고리를 가리지 않는다")
    void sendsForFocusWindowChallenge() {
        GroupChallenge challenge = challenge(MissionCategory.FOCUS);
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));
        User member = user(UUID.randomUUID());
        givenMembers(challenge, member);
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        assertThat(summary.sentCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("한 그룹에서 두 창형이 같이 끝나면 푸시는 1건, 발송 이력은 두 챌린지 모두에 남는다")
    void collapsesSimultaneousEndsWithinGroup() {
        GroupChallenge screenTime = challenge(MissionCategory.SCREEN_TIME);
        GroupChallenge focus = challenge(MissionCategory.FOCUS);
        givenChallenges(List.of(screenTime, focus),
                List.of(window(screenTime, kstTimeOf(9, 0), kstTimeOf(12, 0)),
                        window(focus, kstTimeOf(10, 0), kstTimeOf(12, 0))));
        User member = user(UUID.randomUUID());
        givenMembers(screenTime, member);
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        assertThat(summary.targetCount()).isEqualTo(1);
        assertThat(summary.sentCount()).isEqualTo(1);
        verify(pushNotificationService).sendIfAllowed(any(), any(), any(), any());
        assertThat(savedLogs())
                .extracting(NotificationSentLog::getTargetUserId)
                .containsExactlyInAnyOrder(screenTime.getId(), focus.getId());
    }

    @Test
    @DisplayName("창이 아직 안 끝났으면 대상 0건 — 그룹원 조회조차 하지 않는다")
    void skipsWhenWindowStillOpen() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 11, 59));

        assertThat(summary.targetCount()).isZero();
        verify(groupMemberRepository, never()).findByGroupIdIn(anyCollection());
    }

    @Test
    @DisplayName("종료 후 한참 지난 창(감지 폭 밖)은 발송하지 않는다 — 뒤늦은 푸시 방지")
    void skipsLongEndedWindow() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 13, 0));

        assertThat(summary.targetCount()).isZero();
    }

    @Test
    @DisplayName("창이 끝난 뒤에 만들어진 챌린지는 제외 — 아무도 참여하지 않은 회차에 결과 알림 금지")
    void skipsChallengeCreatedAfterWindowEnd() {
        // 12:00 종료 창을 12:05 에 만들면, 12:15 틱이 "30분 내 종료" 로 집어 전원에게 알림을 보냈다.
        GroupChallenge challenge = GroupChallenge.builder()
                .id(UUID.randomUUID())
                .group(group())
                .category(MissionCategory.SCREEN_TIME)
                .type(MissionType.TIME_WINDOW)
                .status(GroupChallengeStatus.ACTIVE)
                .createdAt(kst(2026, 8, 2, 12, 5))
                .build();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 15));

        assertThat(summary.targetCount()).isZero();
        verify(groupMemberRepository, never()).findByGroupIdIn(anyCollection());
    }

    @Test
    @DisplayName("회차가 끝난 뒤에 가입한 멤버는 제외 — 참여한 적 없는 회차의 결과 알림 금지")
    void skipsMemberJoinedAfterCycleEnd() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));
        // 창은 12:00 에 끝났는데 12:10 에 가입 → 12:15 틱의 대상이 아니다.
        givenMembersJoinedAt(challenge, kst(2026, 8, 2, 12, 10), user(UUID.randomUUID()));
        givenNoSentLogs();
        givenNoSettings();

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 15));

        assertThat(summary.sentCount()).isZero();
        // 비참여자는 "대상" 도 "dedup" 도 아니다 — 발송 이력이 아예 없으므로 dedupedCount 에 섞이면
        // "이미 보낸 건수" 라는 계약이 깨진다(@codex 리뷰).
        assertThat(summary.targetCount()).isZero();
        assertThat(summary.dedupedCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("비활성 요일의 창 종료는 알리지 않는다 — 회차가 서지 않은 날엔 마감도 없다 (FR-9 · GROMO-1260)")
    void skipsWindowEndOnInactiveDay() {
        // 2026-08-02 는 일요일 — 월요일 전용(마스크 1) 챌린지의 창(09:00~12:00)은 이날 돌지 않았다.
        GroupChallenge challenge = GroupChallenge.builder()
                .id(UUID.randomUUID())
                .group(group())
                .category(MissionCategory.SCREEN_TIME)
                .type(MissionType.TIME_WINDOW)
                .status(GroupChallengeStatus.ACTIVE)
                .repeatDays(RepeatSchedule.bit(DayOfWeek.MONDAY))
                .createdAt(Instant.EPOCH)
                .build();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 15));

        assertThat(summary.targetCount()).isZero();
        assertThat(summary.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("심야 창(23:00~23:59)의 종료도 당일 안에서 잡힌다 — 자정 걸침 창은 V35 이후 존재하지 않는다")
    void detectsLateNightWindowOnSameDay() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, kstTimeOf(23, 0), kstTimeOf(23, 59)));
        User member = user(UUID.randomUUID());
        givenMembers(challenge, member);
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 0, 10));

        assertThat(summary.sentCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 날 이미 보낸 유저는 dedup — 15분마다 다시 돌아도 재발송하지 않는다")
    void dedupsWithinSameDay() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));
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
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));
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
    @DisplayName("문구는 승패를 담지 않고, 딥링크에 결과 모달용 challenge 가 붙는다")
    void composesResultCheckMessage() {
        GroupChallenge challenge = challenge();
        givenChallenge(challenge, window(challenge, kstTimeOf(9, 0), kstTimeOf(12, 0)));
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
        // 앱 파서(readGroupParam)는 UUID 뒤 룩어헤드로 g 를 잘라내므로 &challenge= 를 붙여도 안전하다(계약 §2).
        assertThat(message.link())
                .isEqualTo("gromo://group?g=" + GROUP_ID + "&challenge=" + challenge.getId());
        assertThat(message.data()).containsEntry("type", "CHALLENGE_WINDOW_END")
                .containsEntry("groupId", GROUP_ID.toString())
                .containsEntry("challengeId", challenge.getId().toString());
    }

    @Test
    @DisplayName("활성 창형 챌린지가 없으면 창 조회조차 하지 않는다")
    void returnsEmptyWhenNoActiveChallenges() {
        given(groupChallengeRepository.findActiveByType(
                GroupChallengeStatus.ACTIVE, MissionType.TIME_WINDOW))
                .willReturn(List.of());

        PushDispatchSummaryResponse summary =
                service().sendWindowEndNotifications(kst(2026, 8, 2, 12, 5));

        assertThat(summary.targetCount()).isZero();
        verify(groupChallengeWindowRepository, never()).findByChallengeIdIn(anyCollection());
    }

    /** 발송 이력으로 저장된 행 — saveAll 인자를 모아서 돌려준다. */
    private List<NotificationSentLog> savedLogs() {
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<NotificationSentLog>> captor = ArgumentCaptor.forClass(List.class);
        verify(notificationSentLogRepository).saveAll(captor.capture());
        return new ArrayList<>(captor.getValue());
    }
}
