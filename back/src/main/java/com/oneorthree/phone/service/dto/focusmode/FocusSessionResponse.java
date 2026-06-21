package com.oneorthree.phone.service.dto.focusmode;

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
    String subject;
    Instant startedAt;
    Instant endedAt;
    int distractionCount;
    int totalDistractionSeconds;
}
