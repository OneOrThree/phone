package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import org.junit.jupiter.api.Test;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class NotificationBatchRetryTest {

    private static final Instant SLOT = Instant.parse("2026-09-11T03:00:00Z");

    @Test
    void serializationRetriesAreBoundedAndKeepOriginalSlot() {
        var properties = new NotificationDispatchProperties();
        properties.setMode(NotificationDispatchProperties.Mode.OUTBOX);
        var retry = new NotificationBatchRetry(properties, Clock.fixed(SLOT, ZoneOffset.UTC));
        List<Instant> calls = new ArrayList<>();
        var failure = new IllegalStateException(new SQLException("conflict", "40001"));
        assertThatThrownBy(() -> retry.run(slot -> {
            calls.add(slot);
            throw failure;
        })).isSameAs(failure);
        assertThat(calls).containsExactly(SLOT, SLOT, SLOT);
    }

    @Test
    void legacyExternalEffectsAndUnrelatedFailuresAreNeverRetried() {
        for (boolean outbox : List.of(false, true)) {
            var properties = new NotificationDispatchProperties();
            if (outbox) {
                properties.setMode(NotificationDispatchProperties.Mode.OUTBOX);
            }
            var retry = new NotificationBatchRetry(properties, Clock.fixed(SLOT, ZoneOffset.UTC));
            var failure = new IllegalStateException(new SQLException("failure", outbox ? "23505" : "40001"));
            List<Instant> calls = new ArrayList<>();
            assertThatThrownBy(() -> retry.run(slot -> {
                calls.add(slot);
                throw failure;
            })).isSameAs(failure);
            assertThat(calls).containsExactly(SLOT);
        }
    }
}
