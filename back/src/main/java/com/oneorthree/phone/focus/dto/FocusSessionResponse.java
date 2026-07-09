package com.oneorthree.phone.focus.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionResponse {
    UUID focusTagId;
    Instant startedAt;
    Instant endedAt;
    int totalDistractionSeconds;
}
