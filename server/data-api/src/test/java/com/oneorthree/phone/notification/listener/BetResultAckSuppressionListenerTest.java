package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.group.event.BetResultAcknowledgedEvent;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.event.EventListener;
import org.springframework.transaction.event.TransactionalEventListener;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

/**
 * 결과 확인 푸시 억제가 <b>동기</b>로 남아 있는지 못박는다 (B17 · GROMO-1656).
 *
 * <p><b>왜 리플렉션으로 애노테이션을 보는가.</b> 이 리스너를 이웃들처럼
 * {@code @TransactionalEventListener(AFTER_COMMIT)} 로 바꾸는 것은 <b>한 줄 수정으로 컴파일되고
 * 기능 테스트도 전부 초록으로 남는다</b> — 억제는 여전히 일어나기 때문이다. 다만 <b>조금 늦게</b>
 * 일어나고, 그 지연 동안 5분 주기 flush 크론이 끼면 「이미 본 결과」의 푸시가 나간다.
 * 그리고 억제 실패가 ack 를 되돌리지 못하게 된다.
 *
 * <p>이 결함은 <b>타이밍에서만</b> 드러나므로 동작 테스트로는 잡을 수 없다. 잡을 수 있는 것은
 * 「어떤 애노테이션이 붙어 있는가」뿐이라, 그것을 단언한다.
 *
 * <p>같은 이유로 {@code @Async} 도 금지다 — 별도 스레드로 나가면 발행 트랜잭션 밖이 되어
 * 롤백과 함께 되돌아가지 않는다.
 */
@ExtendWith(MockitoExtension.class)
class BetResultAckSuppressionListenerTest {

    @Mock
    private BetEventNotificationService betEventNotificationService;

    @InjectMocks
    private BetResultAckSuppressionListener listener;

    private Method handler() throws NoSuchMethodException {
        return BetResultAckSuppressionListener.class
                .getDeclaredMethod("onResultAcknowledged", BetResultAcknowledgedEvent.class);
    }

    @Test
    @DisplayName("평범한 @EventListener 다 — 커밋 이후로 미루면 5분 크론이 그 창에 끼어든다")
    void handlerRunsInsideThePublishingTransaction() throws NoSuchMethodException {
        Method handler = handler();

        assertThat(handler.isAnnotationPresent(EventListener.class))
                .as("발행 트랜잭션 안에서 지금 돌아야 한다")
                .isTrue();
        assertThat(handler.isAnnotationPresent(TransactionalEventListener.class))
                .as("AFTER_COMMIT 으로 미루면 그 사이 5분 flush 크론이 PENDING 을 집어 발송한다")
                .isFalse();
        assertThat(handler.isAnnotationPresent(org.springframework.scheduling.annotation.Async.class))
                .as("별도 스레드로 나가면 ack 롤백과 함께 되돌아가지 않는다")
                .isFalse();
    }

    @Test
    @DisplayName("이벤트의 세 값을 그대로 억제 호출에 넘긴다")
    void forwardsEventFieldsUnchanged() {
        UUID userId = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000b2");
        Instant now = Instant.parse("2026-09-08T12:00:00Z");

        listener.onResultAcknowledged(new BetResultAcknowledgedEvent(userId, sessionId, now));

        verify(betEventNotificationService).suppressResultPushOnAck(userId, sessionId, now);
    }
}
