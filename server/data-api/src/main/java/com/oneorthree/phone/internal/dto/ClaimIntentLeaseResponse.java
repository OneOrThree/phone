package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * claim 의도 선점 결과.
 *
 * <p>{@code leased=false} 는 <b>오류가 아니다</b> — 남이 잡고 있거나 이미 끝났다는 사실이다. 그것을
 * 실패로 올리면 재개 실행자가 정상 경합을 오류로 세고 멈춘다.
 *
 * @param leased         이번 호출이 선점했는가
 * @param leaseToken     펜싱 토큰 — 완료 보고에 그대로 실어야 한다. 선점 실패면 {@code null}
 * @param leaseExpiresAt 리스 만료
 */
public record ClaimIntentLeaseResponse(boolean leased, UUID leaseToken, Instant leaseExpiresAt) {
}
