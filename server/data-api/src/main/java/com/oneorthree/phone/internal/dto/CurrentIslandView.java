package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code PUT /internal/users/{userId}/current-island} 응답 (GROMO-1759, LLD §3.6).
 *
 * <p>한 칸짜리 record 인 것이 계약이다 — 값이 null 이어도 {@code {"currentIslandId":null}} 이라
 * 빈 본문이 되지 않는다. Business 의 {@code InternalHttpClient} 가 빈 본문을 계약 불일치(502)로
 * 올리므로 "없음"을 빈 응답으로 표현하면 정상 null 이 장애로 둔갑한다(GROMO-1764 선례).
 */
public record CurrentIslandView(UUID currentIslandId) {
}
