package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.config.NotificationAsyncConfig;
import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.annotation.Async;
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
 * <p>② <b>비동기 발송</b> — {@code afterCommit} 은 바깥 트랜잭션의 커넥션이 반납되기 전에 돈다.
 * 요청 스레드에서 그대로 발송하면 요청 하나가 커넥션 두 개를 물어 풀을 고갈시킨다(@codex 리뷰 P1,
 * {@code FriendPushConnectionUsageTest} 가 실증). 그래서 전용 executor 로 넘기는 것이 계약이다.
 *
 * <p>③ <b>예외 격리</b> — 알림 실패가 이미 커밋된 친구 요청 API 를 깨뜨리면 안 된다.
 */
@ExtendWith(MockitoExtension.class)
class FriendNotificationEventListenerTest {

    @Mock
    private FriendNotificationService friendNotificationService;
    private FriendNotificationEventListener listener;

    @BeforeEach
    void assembleListener() {
        listener = new FriendNotificationEventListener(legacyDispatcher(), friendNotificationService);
    }

    /**
     * 구 경로로 고정한 dispatcher — 이 리스너가 못박는 계약은 {@code LEGACY} 동작이다.
     *
     * <p>리스너는 dispatcher 에게 <b>모드만</b> 묻고 발송은 넘기지 않으므로 producer·발송부를
     * {@code null} 로 둔다. 기본 모드가 실수로 {@code OUTBOX} 로 바뀌면 이 리스너는 발송 위임을
     * 통째로 건너뛰므로, 아래 위임 단언이 조용히 통과하지 않고 그 자리에서 터진다.
     *
     * @return 구 경로 dispatcher
     */
    private static NotificationDispatcher legacyDispatcher() {
        return new NotificationDispatcher(new NotificationDispatchProperties(), null, null, null);
    }

    private static final UUID RECIPIENT_ID = UUID.randomUUID();
    private static final UUID COUNTERPART_ID = UUID.randomUUID();
    private static final UUID REQUEST_ID = UUID.randomUUID();

    @Test
    @DisplayName("요청 이벤트 → 수신자·상대 순서 그대로 발송 위임")
    void onFriendRequestSent_delegates() {
        listener.onFriendRequestSent(new FriendRequestSentEvent(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID));

        verify(friendNotificationService).notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID);
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
    @DisplayName("두 핸들러 모두 전용 executor 로 비동기 — 요청 스레드가 커넥션을 두 개 물지 않는다")
    void handlersAreAsyncOnPushExecutor() throws NoSuchMethodException {
        assertAsyncOnPushExecutor("onFriendRequestSent", FriendRequestSentEvent.class);
        assertAsyncOnPushExecutor("onFriendRequestAccepted", FriendRequestAcceptedEvent.class);
    }

    @Test
    @DisplayName("발송이 실패해도 예외를 밖으로 던지지 않는다 — 커밋된 친구 요청을 500 으로 뒤집지 않기 위해")
    void sendFailure_isIsolated() {
        willThrow(new IllegalStateException("FCM 장애"))
                .given(friendNotificationService).notifyFriendRequest(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID);

        assertThatCode(() -> listener.onFriendRequestSent(
                new FriendRequestSentEvent(REQUEST_ID, RECIPIENT_ID, COUNTERPART_ID)))
                .doesNotThrowAnyException();
    }

    private void assertAsyncOnPushExecutor(String methodName, Class<?> eventType)
            throws NoSuchMethodException {
        Async annotation = FriendNotificationEventListener.class
                .getMethod(methodName, eventType)
                .getAnnotation(Async.class);
        assertThat(annotation).as("%s 는 @Async 여야 한다", methodName).isNotNull();
        // 분석 이벤트용 ga4Executor 로 새면 정책이 다른 풀(유실 허용)에 알림이 실린다.
        assertThat(annotation.value()).isEqualTo(NotificationAsyncConfig.PUSH_EXECUTOR);
    }

    private void assertAfterCommit(String methodName, Class<?> eventType) throws NoSuchMethodException {
        Method method = FriendNotificationEventListener.class.getMethod(methodName, eventType);
        TransactionalEventListener annotation = method.getAnnotation(TransactionalEventListener.class);
        assertThat(annotation).as("%s 는 @TransactionalEventListener 여야 한다", methodName).isNotNull();
        assertThat(annotation.phase()).isEqualTo(TransactionPhase.AFTER_COMMIT);
    }
}
