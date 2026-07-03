package com.oneorthree.phone.analytics.domain;

import com.oneorthree.phone.common.logging.ActivityEvent;

import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * FE 수신 이벤트 화이트리스트 — POST /analytics/events 로 받을 수 있는 이벤트 카탈로그.
 * 미등록 문자열은 400 처리해 임의 문자열 로깅을 원천 차단한다.
 * 확장 = 상수 1줄 추가 (GROMO-470 구현 중 필요 이벤트는 여기에만 늘린다).
 */
public enum ClientActivityEvent implements ActivityEvent {

    FOCUS_SESSION_STARTED("focus_session_started", "focus"),
    FOCUS_SESSION_ABANDONED("focus_session_abandoned", "focus");

    private static final Map<String, ClientActivityEvent> BY_EVENT = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(ClientActivityEvent::event, Function.identity()));

    private final String event;
    private final String category;

    ClientActivityEvent(String event, String category) {
        this.event = event;
        this.category = category;
    }

    /** 화이트리스트 룩업 — 미등록 이벤트 문자열은 empty. */
    public static Optional<ClientActivityEvent> from(String event) {
        return Optional.ofNullable(BY_EVENT.get(event));
    }

    @Override
    public String event() {
        return event;
    }

    @Override
    public String category() {
        return category;
    }
}
