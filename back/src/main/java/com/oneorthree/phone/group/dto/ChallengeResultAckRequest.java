package com.oneorthree.phone.group.dto;

import java.util.UUID;

/**
 * 결과 확인 표시(ack) 요청 (GROMO-1577 · policy N58·B17).
 *
 * <p>선점(claim) 응답으로 받은 토큰을 그대로 실어 보낸다. 서버는 토큰이 <b>현재 선점과 같을 때만</b>
 * 확인 처리한다 — 내 선점이 만료돼 다른 기기가 재선점한 뒤 깨어난 기기가, 자기가 띄우지도 못한
 * 결과를 확인 처리해 어느 기기에서도 못 보게 만드는 것을 막는다(IA §4.3).
 *
 * @param claimToken 확인 처리할 선점의 토큰 — 불일치면 {@code RESULT_CLAIM_STALE} 409
 */
public record ChallengeResultAckRequest(UUID claimToken) {
}
