package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.notification.service.ChallengeCreatedNotificationService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.annotation.Async;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;

/**
 * 개설 알림 진입점의 <b>배선</b> 테스트 (GROMO-1089).
 *
 * <p>이 클래스가 지키는 계약은 "언제·어느 스레드에서 도느냐" 뿐이고, 발송 규칙은
 * {@code ChallengeCreatedNotificationServiceTest} 가 본다.
 */
@ExtendWith(MockitoExtension.class)
class ChallengeCreatedNotificationListenerTest {

    private static final GroupChallengeCreatedEvent EVENT = new GroupChallengeCreatedEvent(
            UUID.fromString("00000000-0000-0000-0000-0000000000c1"),
            UUID.fromString("00000000-0000-0000-0000-0000000000a1"),
            UUID.fromString("00000000-0000-0000-0000-000000000001"));

    @Mock
    private ChallengeCreatedNotificationService challengeCreatedNotificationService;

    @InjectMocks
    private ChallengeCreatedNotificationListener listener;

    @Test
    @DisplayName("AFTER_COMMIT 으로 받는다 → 생성이 롤백되면 리스너까지 오지 않는다")
    void listensAfterCommit() throws NoSuchMethodException {
        // 롤백 시 미발송은 스프링 트랜잭션 이벤트 배선이 보장한다. 목에는 트랜잭션이 없어
        // 롤백 시나리오를 재현할 수 없으므로 "그 배선이 맞게 걸려 있는가" 를 계약으로 고정한다.
        Method method = listenerMethod();

        assertThat(method.getAnnotation(TransactionalEventListener.class)).isNotNull();
        assertThat(method.getAnnotation(TransactionalEventListener.class).phase())
                .isEqualTo(TransactionPhase.AFTER_COMMIT);
    }

    @Test
    @DisplayName("전용 풀에서 비동기로 돈다 → blocking FCM 호출이 챌린지 생성 응답을 물지 않는다")
    void dispatchesOnPushExecutor() throws NoSuchMethodException {
        Method method = listenerMethod();

        assertThat(method.getAnnotation(Async.class)).isNotNull();
        assertThat(method.getAnnotation(Async.class).value()).isEqualTo("pushExecutor");
    }

    @Test
    @DisplayName("발송 실패는 여기서 삼킨다 → 별도 스레드라 밖으로 흘려도 받을 곳이 없다")
    void swallowsFailure() {
        given(challengeCreatedNotificationService.sendCreatedNotifications(any(), any()))
                .willThrow(new IllegalStateException("boom"));

        assertThatCode(() -> listener.onChallengeCreated(EVENT)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("이벤트를 그대로 발송 서비스에 넘긴다")
    void delegatesToService() {
        listener.onChallengeCreated(EVENT);

        verify(challengeCreatedNotificationService)
                .sendCreatedNotifications(eq(EVENT), any(Instant.class));
    }

    private static Method listenerMethod() throws NoSuchMethodException {
        return ChallengeCreatedNotificationListener.class
                .getMethod("onChallengeCreated", GroupChallengeCreatedEvent.class);
    }
}
