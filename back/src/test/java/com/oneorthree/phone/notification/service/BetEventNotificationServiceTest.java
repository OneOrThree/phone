package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
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
 * 사건 단위 알림 파이프라인의 단위 테스트 — 잠그는 성질 다섯:
 * ① BET_VOID_REFUND payload 가 사유 3종(N48)을 정확히 싣는다,
 * ② 같은 슬롯·그룹의 사건 여럿은 한 푸시로 묶이고 묶음 payload 엔 challengeId 가 없다(N20·IA §4.2),
 * ③ 조용한 시간의 표시 푸시는 버려지지 않고 DEFERRED 로 이월된다(N44),
 * ④ 이월분은 flush 에서 발송·SENT 마킹된다,
 * ⑤ 발송 실패·필터 스킵은 클레임을 반납(삭제)해 재훑기가 다시 집게 한다.
 * (선점·리스의 SQL 계약은 NotificationClaimLeaseIntegrationTest, 연속 사건 dedup 은
 * GroupPushNotificationIntegrationTest 가 실 DB 로 잠근다.)
 */
@ExtendWith(MockitoExtension.class)
class BetEventNotificationServiceTest {

    /** KST 12:00 — 조용한 시간(23–07) 밖. */
    private static final Instant NOON = Instant.parse("2026-08-02T03:00:00Z");
    /** KST 00:10 — 조용한 시간 한복판(하루형 자정 정산 직후). */
    private static final Instant MIDNIGHT = Instant.parse("2026-08-01T15:10:00Z");
    /** KST 07:00 — 조용한 시간 종료 정각. */
    private static final Instant SEVEN = Instant.parse("2026-08-01T22:00:00Z");
    private static final UUID GROUP_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private BetEventNotificationService service;

    private static User user(UUID id) {
        return User.builder().id(id).nickname("유저").deviceToken("token-" + id).build();
    }

    private static GroupChallengeBetSession session(
            GroupBetStatus status, GroupBetVoidReason voidReason, Instant settledAt) {
        Group group = Group.builder().id(GROUP_ID).name("그룹").build();
        GroupChallenge challenge = GroupChallenge.builder().id(UUID.randomUUID()).group(group).build();
        return GroupChallengeBetSession.builder()
                .id(UUID.randomUUID())
                .group(group)
                .challenge(challenge)
                .stake(50)
                .sessionDate(LocalDate.of(2026, 8, 1))
                .status(status)
                .voidReason(voidReason)
                .settledAt(settledAt)
                .build();
    }

    private static GroupChallengeBetParticipant participant(
            GroupChallengeBetSession session, User user, Boolean achieved, Integer payout) {
        return GroupChallengeBetParticipant.builder()
                .id(UUID.randomUUID())
                .session(session)
                .user(user)
                .achieved(achieved)
                .payout(payout)
                .build();
    }

    private void givenSession(GroupChallengeBetSession session,
            List<GroupChallengeBetParticipant> participants) {
        given(groupChallengeBetSessionRepository.findById(session.getId()))
                .willReturn(Optional.of(session));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(participants);
    }

    private void givenClaimsSucceed() {
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
    }

    private void givenNoSettings() {
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.<UserNotificationSettings>of());
    }

    private PushMessage sentMessage() {
        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(any(), any(), captor.capture(), any());
        return captor.getValue();
    }

    @Test
    @DisplayName("N48 — CHALLENGE_DELETED 환불 payload: type·groupId·challengeId·voidReason")
    void voidRefundPayloadForChallengeDeleted() {
        assertVoidRefundPayload(GroupBetStatus.VOIDED, GroupBetVoidReason.CHALLENGE_DELETED,
                "챌린지가 삭제돼 무산됐어요 · 참가비는 돌려드렸어요");
    }

    @Test
    @DisplayName("N48 — INSUFFICIENT_PARTICIPANTS 환불 payload")
    void voidRefundPayloadForInsufficientParticipants() {
        assertVoidRefundPayload(GroupBetStatus.VOIDED, GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS,
                "참가자가 부족해 무산됐어요 · 참가비는 돌려드렸어요");
    }

    @Test
    @DisplayName("N48 — REFUND_DEADLINE(24h 자동 환불) payload")
    void voidRefundPayloadForRefundDeadline() {
        assertVoidRefundPayload(GroupBetStatus.REFUNDED, GroupBetVoidReason.REFUND_DEADLINE,
                "정산이 지연돼 참가비를 돌려드렸어요");
    }

    private void assertVoidRefundPayload(GroupBetStatus status, GroupBetVoidReason reason,
            String expectedBody) {
        GroupChallengeBetSession voided = session(status, reason, NOON.minusSeconds(60));
        User target = user(UUID.randomUUID());
        givenSession(voided, List.of(participant(voided, target, null, null)));
        givenClaimsSucceed();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        service.notifySessionClosed(voided.getId(), NOON);

        PushMessage message = sentMessage();
        assertThat(message.body()).isEqualTo(expectedBody);
        assertThat(message.data())
                .containsEntry("type", NotificationSentLog.TYPE_BET_VOID_REFUND)
                .containsEntry("groupId", GROUP_ID.toString())
                .containsEntry("challengeId", voided.getChallenge().getId().toString())
                .containsEntry("voidReason", reason.name());
        // 신설 타입은 link 를 싣지 않는다 — 앱이 data.groupId 로 딥링크를 합성한다(IA §4.2).
        assertThat(message.link()).isNull();
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), eq(NOON));
    }

    @Test
    @DisplayName("N20 — 같은 슬롯·그룹의 결과 2건은 한 푸시로 묶이고, 묶음 payload 엔 challengeId 가 없다")
    void bundlesSameSlotEventsIntoOnePushWithoutChallengeId() {
        UUID userId = UUID.randomUUID();
        User target = user(userId);
        // 같은 15분 슬롯(12:01·12:03 정산)의 서로 다른 회차 2건.
        GroupChallengeBetSession first =
                session(GroupBetStatus.SETTLED, null, Instant.parse("2026-08-02T03:01:00Z"));
        GroupChallengeBetSession second =
                session(GroupBetStatus.SETTLED, null, Instant.parse("2026-08-02T03:03:00Z"));
        given(notificationSentLogRepository.findByStatus(NotificationSendStatus.DEFERRED))
                .willReturn(List.of());
        given(groupChallengeBetSessionRepository.findByStatusInAndSettledAtSince(anyCollection(), any()))
                .willReturn(List.of(first, second));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of(
                        participant(first, target, true, 100),
                        participant(second, target, false, 0)));
        givenClaimsSucceed();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        var summary = service.rescanAndFlush(NOON);

        assertThat(summary.sentCount()).isEqualTo(2);
        PushMessage message = sentMessage();   // 검증: 발송 호출은 정확히 1회(묶음 1건)
        assertThat(message.body()).contains("2건");
        assertThat(message.data())
                .containsEntry("type", NotificationSentLog.TYPE_BET_RESULT)
                .containsEntry("groupId", GROUP_ID.toString())
                .doesNotContainKey("challengeId");
    }

    @Test
    @DisplayName("N44 — 조용한 시간(00:10)의 결과는 발송하지 않고 DEFERRED 로 이월한다")
    void defersDisplayPushDuringQuietHours() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, MIDNIGHT.minusSeconds(120));
        User target = user(UUID.randomUUID());
        givenSession(settled, List.of(participant(settled, target, true, 100)));
        givenClaimsSucceed();
        givenNoSettings();

        service.notifySessionClosed(settled.getId(), MIDNIGHT);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.DEFERRED), eq(null));
        verify(notificationSentLogRepository, never()).deleteByIds(anyCollection());
    }

    @Test
    @DisplayName("N44 — 이월분은 07:00 flush 에서 발송되고 SENT 로 종결된다 (하루형 자정 정산 → 아침 도착)")
    void flushSendsDeferredAfterQuietHours() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, MIDNIGHT.minusSeconds(120));
        User target = user(UUID.randomUUID());
        GroupChallengeBetParticipant betParticipant = participant(settled, target, true, 100);
        NotificationSentLog deferredRow = NotificationSentLog.builder()
                .id(UUID.randomUUID())
                .userId(target.getId())
                .type(NotificationSentLog.TYPE_BET_RESULT)
                .kind(NotificationSentLog.TYPE_BET_RESULT)
                .subjectId(settled.getId())
                .groupId(GROUP_ID)
                .slotAt(BetEventNotificationService.slotOf(settled.getSettledAt()))
                .status(NotificationSendStatus.DEFERRED)
                .claimedAt(MIDNIGHT)
                .build();
        given(notificationSentLogRepository.findByStatus(NotificationSendStatus.DEFERRED))
                .willReturn(List.of(deferredRow));
        given(groupChallengeBetSessionRepository.findAllById(anyCollection()))
                .willReturn(List.of(settled));
        given(groupChallengeBetParticipantRepository.findBySessionIdIn(anyCollection()))
                .willReturn(List.of(betParticipant));
        given(groupChallengeBetSessionRepository.findByStatusInAndSettledAtSince(anyCollection(), any()))
                .willReturn(List.of());
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        var summary = service.rescanAndFlush(SEVEN);

        assertThat(summary.sentCount()).isEqualTo(1);
        verify(notificationSentLogRepository).updateStatusByIds(
                eq(List.of(deferredRow.getId())), eq(NotificationSendStatus.SENT), eq(SEVEN));
        PushMessage message = sentMessage();
        assertThat(message.data()).containsEntry("challengeId",
                settled.getChallenge().getId().toString());
    }

    @Test
    @DisplayName("발송 실패·필터 스킵 — 클레임을 반납(삭제)해 재훑기가 다시 집는다")
    void releasesClaimWhenSendFails() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, NOON.minusSeconds(60));
        User target = user(UUID.randomUUID());
        givenSession(settled, List.of(participant(settled, target, true, 100)));
        givenClaimsSucceed();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(false);

        service.notifySessionClosed(settled.getId(), NOON);

        verify(notificationSentLogRepository).deleteByIds(anyCollection());
        verify(notificationSentLogRepository, never()).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("이미 선점된 사건(INSERT 0 + 리스 생존) — dedup 으로 스킵하고 발송하지 않는다")
    void skipsAlreadyClaimedEvent() {
        GroupChallengeBetSession settled =
                session(GroupBetStatus.SETTLED, null, NOON.minusSeconds(60));
        User target = user(UUID.randomUUID());
        givenSession(settled, List.of(participant(settled, target, true, 100)));
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(0);
        given(notificationSentLogRepository.reclaimExpired(any(), anyString(), any(), any(), any()))
                .willReturn(0);

        service.notifySessionClosed(settled.getId(), NOON);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }
}
