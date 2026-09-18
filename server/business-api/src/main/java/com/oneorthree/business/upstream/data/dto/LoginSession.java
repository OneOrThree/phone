package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

/**
 * Data 가 확정한 로그인 결과 — 공개 201 의 네 필드와 <b>같다</b> (계정 LLD §2.1).
 *
 * <p>상류 DTO 와 공개 DTO 를 같은 모양으로 둔 것은 의도다. 상류에 {@code isNewUser}·provider
 * subject 가 실려 오고 Business 가 그걸 «거르는» 구조였다면, 거르는 줄 하나가 빠지는 순간 노출이다.
 * 애초에 상류가 보내지 않으면 그 사고가 불가능하다.
 */
public record LoginSession(
        String accessToken,
        String refreshToken,
        UUID userId,
        boolean onboardingComplete) {
}
