package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 참여 모집 알림(GROMO-1417, N40·N20·N44)의 단위 테스트 — 잠그는 성질 넷:
 * ① 하루형 슬롯이 당일 08:00 KST 다(전날 23:30 이 아니다 — N40),
 * ② 창형 슬롯은 참가 마감 −30분이고 그 전에는 안 나간다,
 * ③ 이미 참가한 사람은 모집 대상이 아니다,
 * ④ 조용한 시간의 모집은 <b>이월하지 않고 버린다</b>(N44 단서) — 결과 알림과 갈리는 지점.
 */
@ExtendWith(MockitoExtension.class)
class SessionOpenNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DAY = LocalDate.of(2026, 8, 2);
    private static final UUID GROUP_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private com.oneorthree.phone.user.repository.UserNotificationSettingsRepository
            userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private SessionOpenNotificationService service;

    private static Group group() {
        return Group.builder().id(GROUP_ID).name("그룹").build();
    }

    private static User user(String nickname) {
        return User.builder().id(UUID.randomUUID()).nickname(nickname)
                .deviceToken("token-" + nickname).build();
    }

    private static GroupChallengeBetSession durationSession() {
        Group group = group();
        return GroupChallengeBetSession.builder()
                .id(UUID.randomUUID())
                .group(group)
                .challenge(GroupChallenge.builder().id(UUID.randomUUID()).group(group).build())
                .sessionDate(DAY)
                .stake(300)
                .missionCategory(MissionCategory.FOCUS)
                .missionType(MissionType.DURATION)
                .startsAt(DAY.atStartOfDay(KST).toInstant())
                .joinClosesAt(DAY.plusDays(1).atStartOfDay(KST).toInstant())
                .closesAt(DAY.plusDays(1).atStartOfDay(KST).toInstant())
                .settleAfter(DAY.plusDays(1).atStartOfDay(KST).toInstant())
                .build();
    }

    private static GroupChallengeBetSession windowSession(LocalTime windowStart) {
        Group group = group();
        Instant joinClosesAt = DAY.atTime(windowStart).atZone(KST).toInstant();
        return GroupChallengeBetSession.builder()
                .id(UUID.randomUUID())
                .group(group)
                .challenge(GroupChallenge.builder().id(UUID.randomUUID()).group(group).build())
                .sessionDate(DAY)
                .stake(900)
                .missionCategory(MissionCategory.SCREEN_TIME)
                .missionType(MissionType.TIME_WINDOW)
                .windowStart(windowStart)
                .windowEnd(windowStart.plusHours(2))
                .startsAt(joinClosesAt)
                .joinClosesAt(joinClosesAt)
                .closesAt(DAY.atTime(windowStart.plusHours(2)).atZone(KST).toInstant())
                .settleAfter(DAY.atTime(windowStart.plusHours(2)).atZone(KST).toInstant())
                .build();
    }

    private void givenDue(GroupChallengeBetSession session, List<User> members,
            List<GroupChallengeBetParticipant> participants) {
        given(groupChallengeBetSessionRepository.findOpenJoinableSessions(any(), any()))
                .willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(participants);
        given(groupMemberRepository.findByGroupIdIn(anyCollection())).willReturn(members.stream()
                .map(member -> GroupMember.builder().group(session.getGroup()).user(member).build())
                .toList());
    }

    private void givenNoSettings() {
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.<com.oneorthree.phone.user.domain.UserNotificationSettings>of());
    }

    @Test
    @DisplayName("N40 — 하루형 슬롯은 당일 08:00 KST 다 (07:59 엔 안 나가고 08:00 에 나간다)")
    void durationRecruitsAtEightInTheMorning() {
        GroupChallengeBetSession session = durationSession();
        assertThat(SessionOpenNotificationService.slotStartOf(session))
                .isEqualTo(DAY.atTime(8, 0).atZone(KST).toInstant());

        User member = user("멤버");
        givenDue(session, List.of(member), List.of());

        // 07:59 — 슬롯 전이라 대상 0건(조용한 시간 필터가 아니라 슬롯 판정에서 걸린다).
        PushDispatchSummaryResponse early =
                service.sendSessionOpenNotifications(DAY.atTime(7, 59).atZone(KST).toInstant());
        assertThat(early.targetCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());

        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse onTime =
                service.sendSessionOpenNotifications(DAY.atTime(8, 0).atZone(KST).toInstant());

        assertThat(onTime.sentCount()).isEqualTo(1);
        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(any(), any(), captor.capture(), any());
        assertThat(captor.getValue().data())
                .containsEntry("type", NotificationSentLog.TYPE_CHALLENGE_SESSION_OPEN)
                .containsEntry("groupId", GROUP_ID.toString())
                .containsEntry("challengeId", session.getChallenge().getId().toString());
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("창형 슬롯은 참가 마감 −30분 — 31분 전엔 안 나가고 30분 전엔 나간다")
    void windowRecruitsThirtyMinutesBeforeJoinDeadline() {
        GroupChallengeBetSession session = windowSession(LocalTime.of(20, 0));
        assertThat(SessionOpenNotificationService.slotStartOf(session))
                .isEqualTo(DAY.atTime(19, 30).atZone(KST).toInstant());

        User member = user("멤버");
        givenDue(session, List.of(member), List.of());

        assertThat(service.sendSessionOpenNotifications(
                DAY.atTime(19, 29).atZone(KST).toInstant()).targetCount()).isZero();

        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        assertThat(service.sendSessionOpenNotifications(
                DAY.atTime(19, 30).atZone(KST).toInstant()).sentCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("이미 참가한 그룹원은 모집 대상이 아니다")
    void alreadyJoinedMembersAreNotRecruited() {
        GroupChallengeBetSession session = durationSession();
        User joinedMember = user("참가자");
        User idleMember = user("미참가");
        givenDue(session, List.of(joinedMember, idleMember), List.of(
                GroupChallengeBetParticipant.builder()
                        .id(UUID.randomUUID()).session(session).user(joinedMember).build()));
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service.sendSessionOpenNotifications(DAY.atTime(8, 0).atZone(KST).toInstant());

        assertThat(summary.targetCount()).isEqualTo(1);
        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(pushNotificationService).sendIfAllowed(captor.capture(), any(), any(), any());
        assertThat(captor.getValue().getId()).isEqualTo(idleMember.getId());
    }

    @Test
    @DisplayName("N44 단서 — 조용한 시간의 모집은 이월(DEFERRED)하지 않고 SENT 로 종결한다")
    void quietHoursRecruitmentIsTerminatedNotDeferred() {
        // 창 07:15 시작 → 슬롯 06:45(조용한 시간). 07:00 으로 미루면 곧 참가 마감이라 무의미하고,
        // 클레임을 <지우면> 다음 15분 틱이 재선점해 되살아난다 — 그래서 SENT 로 종결한다.
        GroupChallengeBetSession session = windowSession(LocalTime.of(7, 15));
        User member = user("멤버");
        givenDue(session, List.of(member), List.of());
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        givenNoSettings();

        PushDispatchSummaryResponse summary =
                service.sendSessionOpenNotifications(DAY.atTime(6, 45).atZone(KST).toInstant());

        assertThat(summary.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository, never()).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.DEFERRED), any());
        verify(notificationSentLogRepository, never()).deleteByIds(anyCollection());
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("조용한 시간에 종결된 모집은 07:00 틱에 되살아나지 않는다 — 클레임 유니크가 막는다")
    void terminatedRecruitmentDoesNotResurrectAfterQuietHours() {
        // 07:15 시작 창: 06:45 슬롯에서 종결 → 07:00 틱(슬롯 유예 2시간 안)에 다시 집히면 안 된다.
        GroupChallengeBetSession session = windowSession(LocalTime.of(7, 15));
        User member = user("멤버");
        givenDue(session, List.of(member), List.of());
        givenNoSettings();
        // 첫 틱은 선점 성공, 두 번째 틱은 종결된 행과 유니크 충돌(실 DB 동작 — 통합 테스트가 SQL 로 잠근다).
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1, 0);

        service.sendSessionOpenNotifications(DAY.atTime(6, 45).atZone(KST).toInstant());
        PushDispatchSummaryResponse afterQuiet =
                service.sendSessionOpenNotifications(DAY.atTime(7, 0).atZone(KST).toInstant());

        assertThat(afterQuiet.sentCount()).isZero();
        assertThat(afterQuiet.dedupedCount()).isEqualTo(1);
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }
}
