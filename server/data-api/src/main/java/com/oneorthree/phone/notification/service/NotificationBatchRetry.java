package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.util.function.Consumer;

/** 리그 판정의 직렬화 충돌은 트랜잭션 전체를 원래 슬롯으로 다시 실행한다. */
@Component
@RequiredArgsConstructor
@Slf4j
public class NotificationBatchRetry {

    private static final int MAX_ATTEMPTS = 3;

    private final NotificationDispatchProperties properties;
    private final Clock clock;

    /** 현재 슬롯을 한 번만 잡아 모든 재시도에 공유한다. */
    public void run(Consumer<Instant> batch) {
        run(clock.instant(), batch);
    }

    /**
     * 콜백은 별도 빈의 트랜잭션 프록시여야 한다. 실패한 트랜잭션이 완전히 롤백된 뒤 다시 호출한다.
     * LEGACY 는 FCM 외부 효과를 되돌릴 수 없으므로 재시도하지 않는다.
     */
    public void run(Instant slot, Consumer<Instant> batch) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("알림 배치 재시도는 트랜잭션 밖에서 시작해야 합니다");
        }
        int limit = properties.isOutboxMode() ? MAX_ATTEMPTS : 1;
        for (int attempt = 1; ; attempt++) {
            try {
                batch.accept(slot);
                return;
            } catch (RuntimeException failure) {
                if (attempt >= limit || !isSerializationFailure(failure)) {
                    throw failure;
                }
                log.warn("알림 배치 직렬화 충돌 재시도 — slot={}, attempt={}", slot, attempt);
            }
        }
    }

    private static boolean isSerializationFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && "40001".equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }
}
