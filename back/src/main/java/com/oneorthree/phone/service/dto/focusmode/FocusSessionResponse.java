package com.oneorthree.phone.service.dto.focusmode;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionResponse {
    Long focusTagId;
    String subject;
    Instant startedAt;
    Instant endedAt;
    int distractionCount;
    int totalDistractionSeconds;
}
