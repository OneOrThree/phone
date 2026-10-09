package com.oneorthree.phone.focus.support;

import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LiveActivityContentTest {
    private final Instant now = Instant.parse("2026-10-09T01:00:00Z");

    private FocusSessionDetail detail(FocusSessionLifecycle lifecycle) {
        return FocusSessionDetail.builder().userId(UUID.randomUUID()).subject("수학")
                .lastTransitionAt(now.minusSeconds(30)).lifecycle(lifecycle).build();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> aps(FocusSessionDetail detail, List<FocusSessionInterval> intervals) {
        return (Map<String, Object>) LiveActivityContent.payload(detail, intervals, "black",
                now.getEpochSecond(), now).get("aps");
    }

    @Test
    void resumedTimerExcludesRestAndUsesSwiftDateEpoch() {
        var intervals = List.of(
                FocusSessionInterval.builder().kind(FocusIntervalKind.ACTIVE)
                        .startedAt(now.minusSeconds(300)).endedAt(now.minusSeconds(200)).build(),
                FocusSessionInterval.builder().kind(FocusIntervalKind.REST)
                        .startedAt(now.minusSeconds(200)).endedAt(now.minusSeconds(30)).build(),
                FocusSessionInterval.builder().kind(FocusIntervalKind.ACTIVE)
                        .startedAt(now.minusSeconds(30)).build());
        var aps = aps(detail(FocusSessionLifecycle.ACTIVE), intervals);
        var content = (Map<?, ?>) aps.get("content-state");
        assertThat(content.get("anchor")).isEqualTo((double) now.minusSeconds(130).getEpochSecond() - 978307200);
        assertThat(aps.get("timestamp")).isEqualTo(now.getEpochSecond());
        assertThat(aps.get("event")).isEqualTo("update");
    }

    @Test
    void restBecomesStaleAtOneHourAndAllTerminalStatesDismissImmediately() {
        var rest = aps(detail(FocusSessionLifecycle.PAUSED), List.of());
        assertThat(rest.get("stale-date")).isEqualTo(now.plusSeconds(3570).getEpochSecond());
        for (var status : List.of(FocusSessionLifecycle.COMPLETED,
                FocusSessionLifecycle.ABANDONED, FocusSessionLifecycle.MEMBERSHIP_LOST)) {
            var ended = aps(detail(status), List.of());
            assertThat(ended.get("event")).isEqualTo("end");
            assertThat(ended.get("dismissal-date")).isEqualTo(0);
        }
    }
}
