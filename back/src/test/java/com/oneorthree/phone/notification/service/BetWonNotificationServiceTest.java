package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.event.GroupBetWonEvent;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
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
 * 승리 확정 푸시 {@code BET_WON}(PRD FR-43)의 단위 테스트 — 잠그는 성질 넷:
 * ① <b>혼자 먼저 달성한 본인</b>에게 즉시 나간다(전원 확정을 기다리지 않는다 — 정산 리스너와
 * 분리한 이유), ② payload 는 {@code groupId} + {@code challengeId}(IA §4.2)이고 회차를 다시
 * 조회하지 않는다, ③ 같은 회차의 재발행은 클레임 dedup 으로 접힌다,
 * ④ 조용한 시간이면 이월 없이 종결한다(지연된 축하는 의미가 없다 — 결과는 BET_RESULT 가 전한다).
 */
@ExtendWith(MockitoExtension.class)
class BetWonNotificationServiceTest {

    /** KST 12:00 — 조용한 시간 밖. */
    private static final Instant NOON = Instant.parse("2026-08-02T03:00:00Z");
    /** KST 02:00 — 조용한 시간(23–07) 한복판. */
    private static final Instant NIGHT = Instant.parse("2026-08-01T17:00:00Z");

    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID CHALLENGE_ID = UUID.randomUUID();

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private BetWonNotificationService service;

    private final User winner = User.builder()
            .id(UUID.randomUUID()).nickname("먼저달성").deviceToken("token").build();

    private GroupBetWonEvent event() {
        return new GroupBetWonEvent(SESSION_ID, UUID.randomUUID(), winner.getId(),
                GROUP_ID, CHALLENGE_ID);
    }

    private void givenWinnerExists() {
        given(userRepository.findById(winner.getId())).willReturn(Optional.of(winner));
    }

    /** 설정 행 없음 = 기본값(알림 on·심야 기본 구간) — 클레임을 선점한 경로에서만 조회된다. */
    private void givenDefaultSettings() {
        given(userNotificationSettingsRepository.findById(winner.getId()))
                .willReturn(Optional.<UserNotificationSettings>empty());
    }

    @Test
    @DisplayName("FR-43 — 먼저 달성한 본인에게 즉시 발송하고, payload 는 groupId + challengeId 다")
    void sendsImmediatelyToTheWinner() {
        givenWinnerExists();
        givenDefaultSettings();
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOON))).willReturn(true);

        boolean sent = service.sendWonNotification(event(), NOON);

        assertThat(sent).isTrue();
        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        ArgumentCaptor<PushMessage> messageCaptor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService)
                .sendIfAllowed(userCaptor.capture(), any(), messageCaptor.capture(), eq(NOON));
        assertThat(userCaptor.getValue().getId()).isEqualTo(winner.getId());
        assertThat(messageCaptor.getValue().data())
                .containsEntry("type", NotificationSentLog.TYPE_BET_WON)
                .containsEntry("groupId", GROUP_ID.toString())
                .containsEntry("challengeId", CHALLENGE_ID.toString());
        assertThat(messageCaptor.getValue().link()).isNull();
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), eq(NOON));
        // 이벤트가 축을 다 싣고 있어 회차·참가 행을 다시 조회하지 않는다.
        verify(userRepository).findById(winner.getId());
    }

    @Test
    @DisplayName("같은 회차의 재발행은 클레임 dedup 으로 접힌다 — 축하가 두 번 가지 않는다")
    void dedupsRepublishedEvent() {
        givenWinnerExists();
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(0);

        boolean sent = service.sendWonNotification(event(), NOON);

        assertThat(sent).isFalse();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("조용한 시간이면 이월하지 않고 종결한다 — 지연된 축하 대신 BET_RESULT 가 알린다")
    void terminatesDuringQuietHoursWithoutDeferring() {
        givenWinnerExists();
        givenDefaultSettings();
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);

        boolean sent = service.sendWonNotification(event(), NIGHT);

        assertThat(sent).isFalse();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), eq(NIGHT));
        verify(notificationSentLogRepository, never()).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.DEFERRED), any());
        verify(notificationSentLogRepository, never()).deleteByIds(anyCollection());
    }

    @Test
    @DisplayName("발송 실패 — 클레임을 반납한다")
    void releasesClaimOnFailure() {
        givenWinnerExists();
        givenDefaultSettings();
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOON))).willReturn(false);

        assertThat(service.sendWonNotification(event(), NOON)).isFalse();

        verify(notificationSentLogRepository).deleteByIds(anyCollection());
        verify(notificationSentLogRepository, never()).updateStatusByIds(
                anyCollection(), eq(NotificationSendStatus.SENT), any());
    }

    @Test
    @DisplayName("탈퇴한 유저에게는 보내지 않는다 — 클레임도 만들지 않는다")
    void skipsDeletedUser() {
        User deleted = User.builder()
                .id(winner.getId()).nickname("탈퇴").deviceToken("token").isDeleted(true).build();
        given(userRepository.findById(winner.getId())).willReturn(Optional.of(deleted));

        assertThat(service.sendWonNotification(event(), NOON)).isFalse();

        verify(notificationSentLogRepository, never()).insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any());
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("정산 리스너와 별도 빈이다 — 전원 확정이 아니어도 이 경로는 독립적으로 발송한다")
    void isIndependentFromSettlementListener() {
        // 이 서비스는 회차의 미확정 참가자 수를 보지 않는다(조회 자체를 하지 않는다) — 정산 리스너의
        // 조기 반환(전원 확정 아님)에 영향받지 않는다는 것이 FR-43 배선의 핵심이다.
        givenWinnerExists();
        givenDefaultSettings();
        given(notificationSentLogRepository.insertPendingClaim(
                any(), any(), anyString(), any(), any(), any(), any())).willReturn(1);
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), eq(NOON))).willReturn(true);

        assertThat(service.sendWonNotification(event(), NOON)).isTrue();

        assertThat(List.of(service.getClass().getDeclaredFields()))
                .noneSatisfy(field -> assertThat(field.getType().getSimpleName())
                        .contains("GroupChallengeBetSessionRepository"));
    }
}
