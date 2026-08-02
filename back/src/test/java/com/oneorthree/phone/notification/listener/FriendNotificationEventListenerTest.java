package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.lang.reflect.Method;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.verify;

/**
 * 친구 푸시 리스너의 <b>계약 두 가지</b>를 잠근다 (GROMO-1090).
 *
 * <p>① <b>커밋 이후 발송</b> — 두 핸들러가 {@code @TransactionalEventListener(AFTER_COMMIT)} 이어야
 * 한다. 누가 {@code @EventListener} 로 바꾸면 롤백된 친구 요청에도 푸시가 나가는데, 그 회귀는 목
 * 기반 단위 테스트로는 드러나지 않는다(리스너를 직접 호출하면 언제나 발송된다). 그래서 발송 시점을
 * 결정하는 애노테이션 자체를 검증한다.
 *
 * <p>② <b>예외 격리</b> — {@code afterCommit} 콜백의 예외는 커밋을 호출한 쪽까지 전파되므로,
 * 알림 실패가 이미 커밋된 친구 요청 API 를 500 으로 뒤집으면 안 된다.
 */
@ExtendWith(MockitoExtension.class)
class FriendNotificationEventListenerTest {

    @Mock
    private FriendNotificationService friendNotificationService;
    @InjectMocks
    private FriendNotificationEventListener listener;

    private static final UUID RECIPIENT_ID = UUID.randomUUID();
    private static final UUID COUNTERPART_ID = UUID.randomUUID();

    @Test
    @DisplayName("요청 이벤트 → 수신자·상대 순서 그대로 발송 위임")
    void onFriendRequestSent_delegates() {
        listener.onFriendRequestSent(new FriendRequestSentEvent(RECIPIENT_ID, COUNTERPART_ID));

        verify(friendNotificationService).notifyFriendRequest(RECIPIENT_ID, COUNTERPART_ID);
    }

    @Test
    @DisplayName("수락 이벤트 → 요청자·수락자 순서 그대로 발송 위임")
    void onFriendRequestAccepted_delegates() {
        listener.onFriendRequestAccepted(new FriendRequestAcceptedEvent(RECIPIENT_ID, COUNTERPART_ID));

        verify(friendNotificationService).notifyFriendAccepted(RECIPIENT_ID, COUNTERPART_ID);
    }

    @Test
    @DisplayName("두 핸들러 모두 AFTER_COMMIT 리스너 — 롤백된 요청에는 푸시가 나가지 않는다")
    void handlersAreBoundToAfterCommit() throws NoSuchMethodException {
        assertAfterCommit("onFriendRequestSent", FriendRequestSentEvent.class);
        assertAfterCommit("onFriendRequestAccepted", FriendRequestAcceptedEvent.class);
    }

    @Test
    @DisplayName("발송이 실패해도 예외를 밖으로 던지지 않는다 — 커밋된 친구 요청을 500 으로 뒤집지 않기 위해")
    void sendFailure_isIsolated() {
        willThrow(new IllegalStateException("FCM 장애"))
                .given(friendNotificationService).notifyFriendRequest(RECIPIENT_ID, COUNTERPART_ID);

        assertThatCode(() -> listener.onFriendRequestSent(
                new FriendRequestSentEvent(RECIPIENT_ID, COUNTERPART_ID))).doesNotThrowAnyException();
    }

    private void assertAfterCommit(String methodName, Class<?> eventType) throws NoSuchMethodException {
        Method method = FriendNotificationEventListener.class.getMethod(methodName, eventType);
        TransactionalEventListener annotation = method.getAnnotation(TransactionalEventListener.class);
        assertThat(annotation).as("%s 는 @TransactionalEventListener 여야 한다", methodName).isNotNull();
        assertThat(annotation.phase()).isEqualTo(TransactionPhase.AFTER_COMMIT);
    }
}
