package com.oneorthree.phone.user.dto;

import java.time.Instant;

/**
 * 소셜 연동 계정 조회 응답 DTO.
 * provider: Provider enum 명칭 (APPLE, GOOGLE, …)
 * linkedAt: 연동 생성 시각
 */
public record SocialLinkResponse(
        String provider,
        Instant linkedAt
) {}
