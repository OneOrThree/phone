package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import com.oneorthree.phone.notification.producer.NotificationFanOutPartiallyCommittedException;
import com.oneorthree.phone.notification.producer.NotificationFanOutProgress;
import com.oneorthree.phone.notification.producer.NotificationLockConflicts;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.util.function.Consumer;

/**
 * 알림 배치의 <b>잠금 충돌</b>은 트랜잭션 전체를 원래 슬롯으로 다시 실행한다 — 단, 이미 커밋된 조각이 없을 때만
 * (GROMO-893).
 *
 * <h2>무엇을 다시 도는가</h2>
 * {@code 40001}(RR 판정 스냅샷 이후의 동시 변경)과 {@code 40P01}(교착 희생자) 둘 다다. 둘 다 PostgreSQL 이
 * 그 트랜잭션 «전체»를 되돌린 뒤 올리는 신호다. 조각 쓰기의 잠금 충돌은 {@code NotificationFanOutWriter} 가 같은
 * 요청으로 먼저 다시 적으므로, 여기까지 오는 것은 판정 트랜잭션 자체의 충돌이거나 조각 재시도가 소진된 경우다.
 *
 * <h2>커밋된 조각이 있으면 다시 판정하지 않는다</h2>
 * 배치는 판정 스냅샷 하나로 후보를 고르고 적기만 짧은 조각으로 나눈다. 조각 하나라도 커밋된 뒤 새 스냅샷으로 다시
 * 판정하면 그사이 상태가 바뀐 사용자에게 <b>다른 종류</b>의 알림이 같은 슬롯에 한 번 더 적힌다 — 결정적 키가 종류를
 * 축으로 가져 접히지 않는다. 그래서 이 배치 실행에서 커밋된 조각이 있으면 실패의 종류와 무관하게(잠금 충돌이 아니어도)
 * 재시도하지 않고
 * {@code notification.batch.partial_commit} 지표와 원래 슬롯의 재생 좌표를 남긴 채 실패를 올린다.
 *
 * <h2>구 경로는 다시 돌지 않는다</h2>
 * {@code LEGACY} 는 FCM 을 직접 부른다. 이미 나간 푸시는 롤백되지 않으므로 다시 돌면 같은 사용자에게 두 번 간다.
 *
 * <h2>소진되면 원래 슬롯을 남긴다</h2>
 * 재시도가 다 떨어지면 {@code notification.batch.retry.exhausted} 지표를 올리고, 운영자가 그대로 옮겨 칠 수 있는
 * 재생 좌표(ShedLock 이름 + 원래 슬롯)를 오류 로그에 남긴 뒤 예외를 그대로 올린다. 「지금」으로 다시 돌리면
 * 리그 마감·오늘 같은 날짜 판정이 다른 슬롯으로 바뀐다.
 */
@Slf4j
@Component
public class NotificationBatchRetry {

    /** 신 경로의 최대 시도 횟수. */
    static final int MAX_ATTEMPTS = 3;

    /** 재시도 한 번마다 올리는 지표. 태그: {@code job}·{@code sqlState}. */
    public static final String RETRY_METRIC = "notification.batch.retry";

    /** 재시도 소진 지표. 태그: {@code job}·{@code sqlState}. */
    public static final String EXHAUSTED_METRIC = "notification.batch.retry.exhausted";

    /** 커밋된 조각이 있어 재판정을 포기한 지표. 태그: {@code job}·{@code sqlState}(잠금 충돌이 아니면 {@code none}). */
    public static final String PARTIAL_COMMIT_METRIC = "notification.batch.partial_commit";

    /** 잠금 충돌이 아닌 실패의 지표 태그 값. */
    static final String NO_SQL_STATE = "none";

    private final NotificationDispatchProperties properties;
    private final Clock clock;
    private final ObjectProvider<MeterRegistry> meterRegistry;
    private final NotificationFanOutProgress progress;

    public NotificationBatchRetry(NotificationDispatchProperties properties, Clock clock,
                                  ObjectProvider<MeterRegistry> meterRegistry, NotificationFanOutProgress progress) {
        this.properties = properties;
        this.clock = clock;
        this.meterRegistry = meterRegistry;
        this.progress = progress;
    }

    /**
     * 현재 슬롯을 한 번만 잡아 모든 재시도에 공유한다.
     *
     * @param job   ShedLock 이름 — 소진 시 재생 좌표로 남는다
     * @param batch 슬롯을 받아 한 번 실행하는 배치
     */
    public void run(String job, Consumer<Instant> batch) {
        run(job, clock.instant(), batch);
    }

    /**
     * 콜백은 별도 빈의 트랜잭션 프록시여야 한다. 실패한 트랜잭션이 완전히 롤백된 뒤 <b>새 트랜잭션으로</b> 다시 호출한다.
     *
     * @param job   ShedLock 이름 — 소진 시 재생 좌표로 남는다
     * @param slot  원래 슬롯
     * @param batch 슬롯을 받아 한 번 실행하는 배치
     * @throws NotificationFanOutPartiallyCommittedException 커밋된 조각이 있어 재판정하지 않을 때 — 재생 좌표를 싣는다
     */
    public void run(String job, Instant slot, Consumer<Instant> batch) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            // 바깥 트랜잭션에 합류해 돌면 실패한 트랜잭션을 되감지 못한 채 같은 트랜잭션에서 다시 돈다.
            throw new IllegalStateException("알림 배치 재시도는 트랜잭션 밖에서 시작해야 합니다");
        }
        int limit = properties.isOutboxMode() ? MAX_ATTEMPTS : 1;
        try (NotificationFanOutProgress.Scope scope = progress.open()) {
            for (int attempt = 1; ; attempt++) {
                try {
                    batch.accept(slot);
                    return;
                } catch (NotificationFanOutPartiallyCommittedException partial) {
                    throw partialCommit(job, slot, partial);
                } catch (RuntimeException failure) {
                    String sqlState = NotificationLockConflicts.sqlStateOf(failure);
                    if (scope.committedChunks() > 0) {
                        // 잠금 충돌이 아닌 실패도 커밋된 조각 뒤라면 그대로 올리면 안 된다 — 재생 좌표 없이 올라가면
                        // 운영자 재생이 새 스냅샷으로 다시 판정한다. 부분 커밋으로 올리되 다시 돌지는 않는다.
                        throw partialCommit(job, slot, new NotificationFanOutPartiallyCommittedException(
                                scope.committedChunks(), sqlState, failure));
                    }
                    if (sqlState == null || !properties.isOutboxMode()) {
                        throw failure;
                    }
                    if (attempt >= limit) {
                        count(EXHAUSTED_METRIC, job, sqlState);
                        log.error("알림 배치 재시도 소진 — job={}, 원래 슬롯={}, sqlState={}, 시도 {}회."
                                + " 같은 슬롯으로 재생: NotificationCronReplayService.replay(\"{}\", Instant.parse(\"{}\"))",
                                job, slot, sqlState, attempt, job, slot, failure);
                        throw failure;
                    }
                    count(RETRY_METRIC, job, sqlState);
                    log.warn("알림 배치 잠금 충돌 재시도 — job={}, slot={}, sqlState={}, attempt={}",
                            job, slot, sqlState, attempt);
                }
            }
        }
    }

    private RuntimeException partialCommit(String job, Instant slot,
                                           NotificationFanOutPartiallyCommittedException partial) {
        count(PARTIAL_COMMIT_METRIC, job, partial.getSqlState());
        NotificationFanOutPartiallyCommittedException located = partial.withReplayCoordinates(job, slot);
        log.error(located.getMessage(), located);
        return located;
    }

    private void count(String metric, String job, String sqlState) {
        MeterRegistry registry = meterRegistry.getIfAvailable();
        if (registry != null) {
            registry.counter(metric, "job", job, "sqlState", sqlState == null ? NO_SQL_STATE : sqlState).increment();
        }
    }
}
