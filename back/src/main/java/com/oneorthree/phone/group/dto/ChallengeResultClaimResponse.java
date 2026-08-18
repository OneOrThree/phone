package com.oneorthree.phone.group.dto;

import java.util.UUID;

/**
 * 결과 표시 선점(claim) 성공 응답 (GROMO-1577 · policy B17).
 *
 * <p>토큰은 <b>선점의 버전</b>이다 — 앱은 렌더 직전 이 토큰으로 자기 선점이 아직 활성인지 확인하고,
 * 노출이 끝나면 같은 토큰으로 ack 한다. 만료 시각을 돌려주지 않는 이유는 기기 시계로 만료를
 * 해석하면 안 되기 때문이다(실패 응답의 {@code retryAfterMs} 도 같은 이유로 상대 지연이다).
 *
 * @param claimToken 이번 선점의 토큰 — ack 요청에 그대로 실어 보낸다
 */
public record ChallengeResultClaimResponse(UUID claimToken) {
}
