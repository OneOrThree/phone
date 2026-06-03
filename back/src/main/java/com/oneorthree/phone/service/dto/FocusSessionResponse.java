package com.oneorthree.phone.service.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionResponse {
    Long focusTagId;
    Instant startedAt;
    Instant endedAt;
    int distractionCount;
    int totalDistractionSeconds;
}
