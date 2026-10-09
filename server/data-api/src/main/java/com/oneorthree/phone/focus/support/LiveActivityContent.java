package com.oneorthree.phone.focus.support;

import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Swift Codable Date는 2001 기준 초, APNs timestamp는 1970 기준 초다. */
public final class LiveActivityContent {
    private static final long SWIFT_REFERENCE_SECONDS = 978307200L;

    private LiveActivityContent() {
    }

    public static boolean ended(FocusSessionDetail detail) {
        return detail.getUserId() == null || (detail.getLifecycle() != FocusSessionLifecycle.ACTIVE
                && detail.getLifecycle() != FocusSessionLifecycle.PAUSED);
    }

    public static Map<String, Object> payload(FocusSessionDetail detail, List<FocusSessionInterval> intervals,
                                              String color, long timestamp, Instant now) {
        boolean rest = detail.getLifecycle() == FocusSessionLifecycle.PAUSED;
        long activeSeconds = intervals.stream().filter(i -> i.getKind() == FocusIntervalKind.ACTIVE)
                .mapToLong(i -> Math.max(0, Duration.between(i.getStartedAt(),
                        i.getEndedAt() == null ? now : i.getEndedAt()).getSeconds())).sum();
        Instant anchor = rest ? detail.getLastTransitionAt() : now.minusSeconds(activeSeconds);
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("phase", rest ? "rest" : "focus");
        content.put("subject", rest ? "" : detail.getSubject());
        content.put("catColor", color);
        content.put("anchor", anchor.toEpochMilli() / 1000.0 - SWIFT_REFERENCE_SECONDS);
        Map<String, Object> aps = new LinkedHashMap<>();
        aps.put("timestamp", timestamp);
        aps.put("event", ended(detail) ? "end" : "update");
        aps.put("content-state", content);
        if (ended(detail)) {
            aps.put("dismissal-date", 0);
        } else if (rest) {
            aps.put("stale-date", anchor.plusSeconds(3600).getEpochSecond());
        }
        return Map.of("aps", aps);
    }
}
