package com.oneorthree.phone.focus.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 집중 세션 1건 응답.
 *
 * <p>GROMO-673: {@code focusTagId} 의미는 user_focus_tags.id (세션이 참조하는 채택 태그의 id).
 * JSON 키(focusTagId)는 유지된다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionResponse {
    UUID focusTagId;
    Instant startedAt;
    Instant endedAt;
    int totalDistractionSeconds;
}
