package com.oneorthree.business.api.dto;

import java.util.UUID;

/**
 * 결과 확인 표시(ack) 요청 — 선점 응답으로 받은 토큰을 그대로 실어 보낸다.
 *
 * <p>서버는 토큰이 <b>현재 선점과 같을 때만</b> 확인 처리한다. 불일치면
 * {@code RESULT_CLAIM_STALE}(409)이 상류에서 오고 그대로 중계된다.
 */
public record ChallengeResultAckRequest(UUID claimToken) {
}
