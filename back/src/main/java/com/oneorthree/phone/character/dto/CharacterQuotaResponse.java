package com.oneorthree.phone.character.dto;

import java.time.Instant;

/**
 * 누끼(캐릭터) 생성 쿼터 응답 (GROMO-1045).
 *
 * <p>가입 후 7일은 무제한, 이후 롤링 7일 내 2회로 제한된다.
 *
 * @param unlimited 가입 후 7일 무제한 구간이면 true. true 면 remaining·resetAt 은 null.
 * @param remaining 남은 생성 횟수(0~2). 무제한 구간이면 null.
 * @param resetAt   슬롯이 다시 비는 시각(= 창 내 가장 오래된 생성 + 7일). remaining>0 이거나 무제한이면 null.
 */
public record CharacterQuotaResponse(
        boolean unlimited,
        Integer remaining,
        Instant resetAt
) {
}
