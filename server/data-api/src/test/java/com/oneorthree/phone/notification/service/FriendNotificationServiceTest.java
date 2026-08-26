package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
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

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 친구 요청·수락 푸시의 <b>대상 확정·문구·dedup·기록</b> 단위 테스트 (GROMO-1090).
 *
 * <p>여기서 잠그는 성질은 넷이다: ① 알림이 "모르는 쪽"에게 가는가(요청은 받은 쪽, 수락은 보냈던 쪽),
 * ② 딥링크·{@code data.type} 이 계약값 그대로인가, ③ 같은 상대에게 dedup 창 안에서 두 번 나가지 않는가,
 * ④ 실제 발송이 성사된 건만 sent_log 에 남는가(quiet hours 스킵을 발송으로 오기록하지 않기).
 */
@ExtendWith(MockitoExtension.class)
class FriendNotificationServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-03T03:00:00Z"); // KST 12:00
    private static final UUID RECIPIENT_ID = UUID.randomUUID();
    private static final UUID COUNTERPART_ID = UUID.randomUUID();
    private static final UUID REQUEST_ID = UUID.randomUUID();

    @Mock
    private FriendshipRepository friendshipRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @InjectMocks
    private FriendNotificationService service;

    private static User user(UUID id, String nickname) {
        return User.builder().id(id).nickname(nickname).deviceToken("token-" + id).build();
    }

    /**
     * 수신자 활성·상대 존재 스텁. 알림 설정은 스텁하지 않는다 — 미스텁 {@code Optional} 은
     * {@code Optional.empty()} 라 설정 row 가 없는 유저(기본값: 알림 on·소리 on)와 같은 상태가 된다.
     */
    private void givenBothUsersExist() {
        given(userRepository.findByIdAndIsDeletedFalse(RECIPIENT_ID))
                .willReturn(Optional.of(user(RECIPIENT_ID, "받는사람")));
        given(userRepository.findById(COUNTERPART_ID))
                .willReturn(Optional.of(user(COUNTERPART_ID, "보낸사람")));
    }

    /** 요청이 아직 처리되지 않은(PENDING) 상태 — 요청 알림 경로의 전제. */
    private void givenRequestStillPending() {
        given(friendshipRepository.findStatusByIdAndDeletedAtIsNull(REQUEST_ID))
                .willReturn(Optional.of(FriendshipStatus.PENDING));
    }

    private void givenNoPreviousSend(String type) {
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(eq(type), anyList(), any(Instant.class)))
                .willReturn(List.of());
    }

    private PushMessage captureSentMessage() {
        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(any(User.class), any(), captor.capture(), eq(NOW));
        return captor.getValue();
    }

    @Test
    @DisplayName("친구 요청 — 받은 쪽에게 상대 닉네임 문구 + gromo://friends 딥링크로 발송")
    void notifyFriendRequest_sendsToReceiver() {
        givenRequestStillPending();
        givenBothUsersExist();
        givenNoPreviousSend(NotificationSentLog.TYPE_FRIEND_REQUEST);
        given(pushNotificationService.sendIfAllowed(any(User.class), any(), any(PushMessage.class), eq(NOW)))
                .willReturn(true);

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        PushMessage message = captureSentMessage();
        assertThat(message.title()).isEqualTo(FriendNotificationService.REQUEST_TITLE);
        assertThat(message.body()).isEqualTo("보낸사람님이 친구 요청을 보냈어요");
        // 딥링크·type 은 앱 라우팅 계약값이다 — 바뀌면 푸시를 눌러도 친구 화면으로 못 간다.
        assertThat(message.link()).isEqualTo("gromo://friends");
        assertThat(message.toDataPayload())
                .containsEntry("type", NotificationSentLog.TYPE_FRIEND_REQUEST)
                .containsEntry("link", "gromo://friends");
    }

    @Test
    @DisplayName("친구 수락 — 요청을 보냈던 쪽에게 수락 문구로 발송")
    void notifyFriendAccepted_sendsToRequester() {
        givenBothUsersExist();
        givenNoPreviousSend(NotificationSentLog.TYPE_FRIEND_ACCEPTED);
        given(pushNotificationService.sendIfAllowed(any(User.class), any(), any(PushMessage.class), eq(NOW)))
                .willReturn(true);

        service.notifyFriendAccepted(RECIPIENT_ID, COUNTERPART_ID, NOW);

        PushMessage message = captureSentMessage();
        assertThat(message.title()).isEqualTo(FriendNotificationService.ACCEPTED_TITLE);
        assertThat(message.body()).isEqualTo("보낸사람님이 친구 요청을 수락했어요");
        assertThat(message.toDataPayload())
                .containsEntry("type", NotificationSentLog.TYPE_FRIEND_ACCEPTED);
    }

    @Test
    @DisplayName("발송 성사 시 sent_log 에 (수신자, type, 상대) 기록 — dedup 소스가 이 행뿐이다")
    void notifyFriendRequest_sent_writesSentLog() {
        givenRequestStillPending();
        givenBothUsersExist();
        givenNoPreviousSend(NotificationSentLog.TYPE_FRIEND_REQUEST);
        given(pushNotificationService.sendIfAllowed(any(User.class), any(), any(PushMessage.class), eq(NOW)))
                .willReturn(true);

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        ArgumentCaptor<NotificationSentLog> captor = ArgumentCaptor.forClass(NotificationSentLog.class);
        verify(notificationSentLogRepository).save(captor.capture());
        NotificationSentLog saved = captor.getValue();
        assertThat(saved.getUserId()).isEqualTo(RECIPIENT_ID);
        assertThat(saved.getType()).isEqualTo(NotificationSentLog.TYPE_FRIEND_REQUEST);
        assertThat(saved.getTargetUserId()).isEqualTo(COUNTERPART_ID);
        assertThat(saved.getSentAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("발송 스킵(알림 off·토큰 없음·quiet hours)이면 sent_log 를 남기지 않는다")
    void notifyFriendRequest_skipped_doesNotWriteSentLog() {
        givenRequestStillPending();
        // 스킵을 기록하면 dedup 이 "이미 보냈다"로 오판해, 알림을 다시 켠 직후의 발송을 잘못 막는다.
        givenBothUsersExist();
        givenNoPreviousSend(NotificationSentLog.TYPE_FRIEND_REQUEST);
        given(pushNotificationService.sendIfAllowed(any(User.class), any(), any(PushMessage.class), eq(NOW)))
                .willReturn(false);

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(notificationSentLogRepository, never()).save(any());
    }

    @Test
    @DisplayName("dedup — 같은 상대에게 방금(창 안에) 보냈으면 재발송하지 않는다")
    void notifyFriendRequest_alreadySent_skips() {
        givenRequestStillPending();
        givenBothUsersExist();
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_FRIEND_REQUEST), anyList(), any(Instant.class)))
                .willReturn(List.of(sentLog(NotificationSentLog.TYPE_FRIEND_REQUEST, COUNTERPART_ID)));

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository, never()).save(any());
    }

    @Test
    @DisplayName("dedup — 다른 상대에게 보낸 기록은 이번 발송을 막지 않는다")
    void notifyFriendRequest_sentToOtherCounterpart_stillSends() {
        givenRequestStillPending();
        // 조회가 (수신자, type, 구간)까지만 좁히므로 상대 판정이 빠지면 A 의 요청 하나가 B·C 의 요청까지 삼킨다.
        givenBothUsersExist();
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_FRIEND_REQUEST), anyList(), any(Instant.class)))
                .willReturn(List.of(sentLog(NotificationSentLog.TYPE_FRIEND_REQUEST, UUID.randomUUID())));
        given(pushNotificationService.sendIfAllowed(any(User.class), any(), any(PushMessage.class), eq(NOW)))
                .willReturn(true);

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(pushNotificationService).sendIfAllowed(any(), any(), any(), eq(NOW));
    }

    @Test
    @DisplayName("dedup 조회창은 now - 1분 — 더 길면 별개의 재요청 알림까지 삼킨다")
    void notifyFriendRequest_looksBack1Minute() {
        givenRequestStillPending();
        givenBothUsersExist();
        givenNoPreviousSend(NotificationSentLog.TYPE_FRIEND_REQUEST);

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        ArgumentCaptor<Instant> since = ArgumentCaptor.forClass(Instant.class);
        verify(notificationSentLogRepository).findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_FRIEND_REQUEST), eq(List.of(RECIPIENT_ID)), since.capture());
        assertThat(since.getValue()).isEqualTo(NOW.minus(Duration.ofMinutes(1)));
    }

    @Test
    @DisplayName("큐에서 대기하는 사이 요청이 처리됐으면 발송하지 않는다 — 목록이 빈 푸시를 막는다")
    void notifyFriendRequest_alreadyHandled_skips() {
        // 발송은 큐를 거치므로 생성 시점과 간격이 있다. 그 사이 수락·거절되면 "새 친구 요청" 은 거짓이다.
        given(friendshipRepository.findStatusByIdAndDeletedAtIsNull(REQUEST_ID))
                .willReturn(Optional.of(FriendshipStatus.ACCEPTED));

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository, never()).save(any());
    }

    @Test
    @DisplayName("PENDING 재확인은 배타 락 조회를 쓰지 않는다 — 발송 동안 요청 행이 잠기면 안 된다")
    void notifyFriendRequest_statusCheck_doesNotLockRow() {
        // findByIdAndDeletedAtIsNull 은 @Lock(PESSIMISTIC_WRITE) 다. 알림 경로가 그걸 쓰면 이 REQUIRES_NEW
        // 트랜잭션이 끝날 때까지 — 즉 FCM 발송이 끝날 때까지 — 행이 잠긴다. FCM RestClient 에 타임아웃이
        // 없어 발송이 멈추면 같은 요청의 수락·거절과 관련 유저의 탈퇴가 무기한 대기한다(@codex 리뷰 P1).
        givenBothUsersExist();
        givenRequestStillPending();
        givenNoPreviousSend(NotificationSentLog.TYPE_FRIEND_REQUEST);

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(friendshipRepository, never()).findByIdAndDeletedAtIsNull(any());
    }

    @Test
    @DisplayName("요청 행이 사라졌으면(탈퇴 정리 등) 발송하지 않는다")
    void notifyFriendRequest_requestGone_skips() {
        given(friendshipRepository.findStatusByIdAndDeletedAtIsNull(REQUEST_ID)).willReturn(Optional.empty());

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("수신자가 탈퇴했으면 발송하지 않는다")
    void notifyFriendRequest_withdrawnRecipient_skips() {
        givenRequestStillPending();
        given(userRepository.findByIdAndIsDeletedFalse(RECIPIENT_ID)).willReturn(Optional.empty());

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(notificationSentLogRepository, never()).save(any());
    }

    @Test
    @DisplayName("상대가 사라졌으면 문구를 만들 수 없으므로 발송하지 않는다")
    void notifyFriendRequest_counterpartGone_skips() {
        givenRequestStillPending();
        given(userRepository.findByIdAndIsDeletedFalse(RECIPIENT_ID))
                .willReturn(Optional.of(user(RECIPIENT_ID, "받는사람")));
        given(userRepository.findById(COUNTERPART_ID)).willReturn(Optional.empty());

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("소리 설정 off 면 무음으로 발송한다")
    void notifyFriendRequest_soundDisabled_sendsSilently() {
        givenRequestStillPending();
        given(userRepository.findByIdAndIsDeletedFalse(RECIPIENT_ID))
                .willReturn(Optional.of(user(RECIPIENT_ID, "받는사람")));
        given(userRepository.findById(COUNTERPART_ID))
                .willReturn(Optional.of(user(COUNTERPART_ID, "보낸사람")));
        given(userNotificationSettingsRepository.findById(RECIPIENT_ID))
                .willReturn(Optional.of(UserNotificationSettings.builder()
                        .userId(RECIPIENT_ID)
                        .notificationEnabled(true)
                        .soundEnabled(false)
                        .build()));
        givenNoPreviousSend(NotificationSentLog.TYPE_FRIEND_REQUEST);

        service.notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID, NOW);

        assertThat(captureSentMessage().soundEnabled()).isFalse();
    }

    private NotificationSentLog sentLog(String type, UUID targetUserId) {
        return NotificationSentLog.builder()
                .id(UUID.randomUUID())
                .userId(RECIPIENT_ID)
                .type(type)
                .targetUserId(targetUserId)
                .sentAt(NOW.minus(Duration.ofSeconds(5)))
                .build();
    }
}
