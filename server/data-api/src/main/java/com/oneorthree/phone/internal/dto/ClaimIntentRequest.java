package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * claim 의도 적재 요청 (A22 ㊄).
 *
 * @param slug 기존 계약과 같은 제약({@code ClaimInviteRequest})
 */
public record ClaimIntentRequest(@NotBlank @Size(max = 12) String slug) {
}
