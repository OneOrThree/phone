package com.oneorthree.business.api.dto;

import java.util.UUID;

/**
 * 결과 표시 선점 요청 — <b>바디 자체가 선택</b>이다(기존 계약 그대로).
 *
 * <p>바디 없음(또는 {@code claimToken} null)은 «최초 획득», 토큰을 실으면 «렌더 직전 재검증 + 리스
 * 연장»이다. 두 경로를 한 엔드포인트가 겸하는 구조를 바꾸지 않는다 — 앱이 그렇게 부른다.
 */
public record ChallengeResultClaimRequest(UUID claimToken) {
}
