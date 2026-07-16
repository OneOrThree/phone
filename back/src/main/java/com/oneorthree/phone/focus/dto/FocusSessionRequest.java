package com.oneorthree.phone.focus.dto;

import com.oneorthree.phone.focus.domain.FocusType;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionRequest {
    UUID focusTagId;
    Instant startedAt;
    Instant endedAt;
    int totalDistractionSeconds;
    // GROMO-733: 세션 유형(INFINITE/RANGE/POMODORO, additive). null 이면 서비스에서 INFINITE 기본(하위호환).
    FocusType focusType;

    /** 하위호환 — focusType 미지정 기존 4-arg 호출부(null → 서비스에서 INFINITE 기본). */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, null);
    }
}
