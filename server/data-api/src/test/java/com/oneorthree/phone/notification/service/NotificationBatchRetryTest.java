package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import com.oneorthree.phone.notification.producer.NotificationFanOutPartiallyCommittedException;
import com.oneorthree.phone.notification.producer.NotificationFanOutProgress;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.ObjectProvider;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 재시도 정책 자체 — 어떤 실패를, 몇 번, 어느 슬롯으로 다시 도는가. */
class NotificationBatchRetryTest {

    private static final Instant SLOT = Instant.parse("2026-09-11T03:00:00Z");
    private static final String JOB = "notification-league-deadline";

    private static NotificationBatchRetry retry(boolean outbox, MeterRegistry registry) {
        var properties = new NotificationDispatchProperties();
        if (outbox) {
            properties.setMode(NotificationDispatchProperties.Mode.OUTBOX);
        }
        @SuppressWarnings("unchecked")
        ObjectProvider<MeterRegistry> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(registry);
        return new NotificationBatchRetry(properties, Clock.fixed(SLOT, ZoneOffset.UTC), provider,
                new NotificationFanOutProgress());
    }

    @ParameterizedTest
    @ValueSource(strings = {"40001", "40P01"})
    @DisplayName("직렬화 실패와 교착 희생자는 원래 슬롯으로 정해진 횟수만 다시 돌고, 소진되면 지표를 남긴다")
    void lockConflictsRetryBoundedWithOriginalSlotAndRecordExhaustion(String sqlState) {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        List<Instant> calls = new ArrayList<>();
        var failure = new IllegalStateException(new SQLException("conflict", sqlState));

        assertThatThrownBy(() -> retry(true, registry).run(JOB, slot -> {
            calls.add(slot);
            throw failure;
        })).isSameAs(failure);

        assertThat(calls).containsExactly(SLOT, SLOT, SLOT);
        assertThat(registry.counter(NotificationBatchRetry.RETRY_METRIC, "job", JOB, "sqlState", sqlState).count())
                .isEqualTo(2.0);
        assertThat(registry.counter(NotificationBatchRetry.EXHAUSTED_METRIC, "job", JOB, "sqlState", sqlState)
                .count()).isEqualTo(1.0);
    }

    @Test
    @DisplayName("교착 뒤 두 번째 시도가 성공하면 소진 지표는 남지 않는다")
    void aDeadlockVictimThatSucceedsOnRetryIsNotExhausted() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        List<Instant> calls = new ArrayList<>();

        retry(true, registry).run(JOB, slot -> {
            calls.add(slot);
            if (calls.size() == 1) {
                throw new IllegalStateException(new SQLException("deadlock", "40P01"));
            }
        });

        assertThat(calls).containsExactly(SLOT, SLOT);
        assertThat(registry.find(NotificationBatchRetry.EXHAUSTED_METRIC).counter()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"40001", "40P01"})
    @DisplayName("구 경로는 FCM 외부 효과를 되돌릴 수 없으므로 잠금 충돌이어도 다시 돌지 않는다")
    void legacyExternalEffectsAreNeverRetried(String sqlState) {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        var failure = new IllegalStateException(new SQLException("failure", sqlState));
        List<Instant> calls = new ArrayList<>();

        assertThatThrownBy(() -> retry(false, registry).run(JOB, slot -> {
            calls.add(slot);
            throw failure;
        })).isSameAs(failure);

        assertThat(calls).containsExactly(SLOT);
        assertThat(registry.getMeters()).isEmpty();
    }

    @Test
    @DisplayName("커밋된 조각이 있다는 실패는 다시 판정하지 않고 원래 슬롯의 재생 좌표를 실어 올린다")
    void aPartiallyCommittedBatchIsNeverRejudged() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        List<Instant> calls = new ArrayList<>();

        assertThatThrownBy(() -> retry(true, registry).run(JOB, slot -> {
            calls.add(slot);
            throw new NotificationFanOutPartiallyCommittedException(2, "40P01",
                    new IllegalStateException(new SQLException("deadlock", "40P01")));
        })).isInstanceOfSatisfying(NotificationFanOutPartiallyCommittedException.class, partial -> {
            assertThat(partial.getReplayJob()).isEqualTo(JOB);
            assertThat(partial.getReplaySlot()).isEqualTo(SLOT);
            assertThat(partial.getMessage()).contains("replay(\"" + JOB + "\", Instant.parse(\"" + SLOT + "\"))");
        });

        assertThat(calls).containsExactly(SLOT);
        assertThat(registry.counter(NotificationBatchRetry.PARTIAL_COMMIT_METRIC, "job", JOB, "sqlState", "40P01")
                .count()).isEqualTo(1.0);
        assertThat(registry.find(NotificationBatchRetry.RETRY_METRIC).counter()).isNull();
    }

    @Test
    @DisplayName("잠금 충돌이 아닌 실패는 신 경로에서도 다시 돌지 않는다")
    void unrelatedFailuresAreNeverRetried() {
        var failure = new IllegalStateException(new SQLException("unique", "23505"));
        List<Instant> calls = new ArrayList<>();

        assertThatThrownBy(() -> retry(true, new SimpleMeterRegistry()).run(JOB, slot -> {
            calls.add(slot);
            throw failure;
        })).isSameAs(failure);

        assertThat(calls).containsExactly(SLOT);
    }
}
