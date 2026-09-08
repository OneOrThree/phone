package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
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
 * 참여 모집 알림(GROMO-1417, N40·N20·N44)의 단위 테스트 — 잠그는 성질 여섯:
 * ① 하루형 슬롯이 당일 08:00 KST 다(전날 23:30 이 아니다 — N40),
 * ② 창형 슬롯은 참가 마감 −30분이고 그 전에는 안 나간다,
 * ③ 이미 참가한 사람은 모집 대상이 아니다,
 * ④ 조용한 시간에 걸려도 <b>종료 시점에 아직 참가할 수 있으면 이월</b>하고, 종료 시점에 이미
 *    마감된 것만 버린다(N44 + 그 단서),
 * ⑤ 이월분은 조용한 시간이 끝난 틱에 실제로 나간다,
 * ⑥ 스캔 이후 참가가 커밋된 유저에게는 발송 직전 재검증으로 모집 푸시가 가지 않는다.
 */
@ExtendWith(MockitoExtension.class)
class SessionOpenNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DAY = LocalDate.of(2026, 8, 2);
    private static final UUID GROUP_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    @Mock
    private GroupQueryService groupQueryService;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private com.oneorthree.phone.user.repository.UserQueryService userQueryService;
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
                .status(GroupBetStatus.OPEN)
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
                .status(GroupBetStatus.OPEN)
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
        given(userQueryService.findAllNotificationSettings(anyCollection()))
                .willReturn(List.<UserNotificationSettings>of());
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
    @DisplayName("N44 단서 — 조용한 시간이 끝나기 전에 이미 마감되는 모집만 SENT 로 종결한다")
    void quietHoursRecruitmentIsTerminatedOnlyWhenJoinClosesFirst() {
        // 창 06:50 시작 → 슬롯 06:20(조용한 시간). 조용한 시간 종료(07:00)에는 이미 참가 마감이라
        // 이월해봐야 "참여하세요"가 거짓말이 된다. 클레임을 <지우면> 다음 15분 틱이 재선점해
        // 되살아나므로 SENT 로 종결한다.
        GroupChallengeBetSession session = windowSession(LocalTime.of(6, 50));
        User member = user("멤버");
        givenDue(session, List.of(member), List.of());
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        givenNoSettings();

        PushDispatchSummaryResponse summary =
                service.sendSessionOpenNotifications(DAY.atTime(6, 20).atZone(KST).toInstant());

        assertThat(summary.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository, never()).deferByIds(anyCollection(), any());
        verify(notificationSentLogRepository, never()).deleteByIds(anyCollection());
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("종결된 모집은 다음 틱에 되살아나지 않는다 — 클레임 유니크가 막는다")
    void terminatedRecruitmentDoesNotResurrect() {
        GroupChallengeBetSession session = windowSession(LocalTime.of(6, 50));
        User member = user("멤버");
        givenDue(session, List.of(member), List.of());
        givenNoSettings();
        // 첫 틱은 선점 성공, 두 번째 틱은 종결된 행과 유니크 충돌(실 DB 동작 — 통합 테스트가 SQL 로 잠근다).
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1, 0);

        service.sendSessionOpenNotifications(DAY.atTime(6, 20).atZone(KST).toInstant());
        PushDispatchSummaryResponse next =
                service.sendSessionOpenNotifications(DAY.atTime(6, 35).atZone(KST).toInstant());

        assertThat(next.sentCount()).isZero();
        assertThat(next.dedupedCount()).isEqualTo(1);
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("조용한 시간이 끝나도 참가할 수 있는 모집은 종결하지 않고 이월한다 (하루형 08:00 × 야간 07–09)")
    void quietHoursRecruitmentIsCarriedWhenStillJoinableAfterwards() {
        // 야간 시간대를 07:00–09:00 으로 둔 유저: 08:00 하루형 슬롯이 조용한 시간에 걸리지만
        // 참가 마감은 자정이다. 여기서 SENT 로 종결하면 이 유저는 모집 알림을 영영 못 받는다.
        GroupChallengeBetSession session = durationSession();
        User member = user("멤버");
        givenDue(session, List.of(member), List.of());
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        given(userQueryService.findAllNotificationSettings(anyCollection()))
                .willReturn(List.of(nightSettings(member, LocalTime.of(7, 0), LocalTime.of(9, 0))));

        PushDispatchSummaryResponse summary =
                service.sendSessionOpenNotifications(DAY.atTime(8, 0).atZone(KST).toInstant());

        assertThat(summary.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository).deferByIds(
                anyCollection(), eq(DAY.atTime(9, 0).atZone(KST).toInstant()));
        verify(notificationSentLogRepository, never()).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("이월된 모집은 조용한 시간이 끝난 틱에 실제로 발송된다")
    void carriedRecruitmentIsSentAfterQuietHours() {
        GroupChallengeBetSession session = durationSession();
        User member = user("멤버");
        NotificationSentLog carried = NotificationSentLog.builder()
                .id(UUID.randomUUID())
                .userId(member.getId())
                .type(NotificationSentLog.TYPE_CHALLENGE_SESSION_OPEN)
                .kind(NotificationSentLog.TYPE_CHALLENGE_SESSION_OPEN)
                .subjectId(session.getId())
                .groupId(GROUP_ID)
                .slotAt(DAY.atTime(8, 0).atZone(KST).toInstant())
                .status(NotificationSendStatus.DEFERRED)
                .nextAttemptAt(DAY.atTime(9, 0).atZone(KST).toInstant())
                .build();
        // 스캔 경로는 비우고 이월 경로만 본다(슬롯 유예를 넘긴 뒤에도 이월분은 살아 있어야 한다).
        given(groupChallengeBetSessionRepository.findOpenJoinableSessions(any(), any()))
                .willReturn(List.of());
        given(notificationSentLogRepository.findDueDeferredClaimsForUpdate(anyCollection(), any()))
                .willReturn(List.of(carried));
        given(groupQueryService.findAllBetSessions(anyCollection()))
                .willReturn(List.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of());
        given(userQueryService.findAllActive(anyCollection())).willReturn(List.of(member));
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service.sendSessionOpenNotifications(DAY.atTime(9, 0).atZone(KST).toInstant());

        assertThat(summary.sentCount()).isEqualTo(1);
        verify(notificationSentLogRepository).updateStatusByIds(
                eq(List.of(carried.getId())), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("스캔 이후 참가가 커밋된 유저에겐 모집 푸시가 가지 않는다 — 발송 직전 재검증")
    void membersWhoJoinAfterTheScanAreNotPushed() {
        GroupChallengeBetSession session = durationSession();
        User member = user("멤버");
        given(groupChallengeBetSessionRepository.findOpenJoinableSessions(any(), any()))
                .willReturn(List.of(session));
        given(groupMemberRepository.findByGroupIdIn(anyCollection())).willReturn(List.of(
                GroupMember.builder().group(session.getGroup()).user(member).build()));
        // 첫 조회(대상 선정)엔 미참가, 두 번째 조회(발송 직전 재검증)엔 이미 참가 — 그사이 커밋됐다.
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of(), List.of(GroupChallengeBetParticipant.builder()
                        .id(UUID.randomUUID()).session(session).user(member).build()));
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);

        PushDispatchSummaryResponse summary =
                service.sendSessionOpenNotifications(DAY.atTime(8, 0).atZone(KST).toInstant());

        assertThat(summary.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository).deleteByIds(anyCollection());
    }

    private static UserNotificationSettings nightSettings(
            User owner, LocalTime start, LocalTime end) {
        return UserNotificationSettings.builder()
                .userId(owner.getId())
                .nightModeEnabled(true)
                .nightStartTime(start)
                .nightEndTime(end)
                .build();
    }
}
