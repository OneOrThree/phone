package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * claim 의도 선점 요청.
 *
 * @param leaseSeconds 리스 유효 기간(초). 짧으면 재개 도중 남이 가로채고, 길면 죽은 실행자의 몫이
 *                     그만큼 묶인다. 상한을 두는 이유는 후자다
 */
public record ClaimIntentLeaseRequest(
        @Min(1) @Max(3600) Integer leaseSeconds) {
}
