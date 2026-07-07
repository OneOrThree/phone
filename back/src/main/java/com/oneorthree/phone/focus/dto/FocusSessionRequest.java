package com.oneorthree.phone.focus.dto;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionRequest {
    UUID focusTagId;
    String subject;
    Instant startedAt;
    Instant endedAt;
    int distractionCount;
    int totalDistractionSeconds;

    // GROMO-643: 클라 로컬 타임존 기준 세션 종료일(달력 날짜). 서버는 UTC 변환 없이 이 날짜로 일별 집계 버킷.
    @NotNull
    LocalDate localDate;
}
