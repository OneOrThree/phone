package com.oneorthree.phone.group.dto;

import java.util.UUID;

/**
 * 결과 표시 선점(claim) 요청 (GROMO-1577 · policy B17 · IA §4.3) — <b>바디 자체가 선택</b>이다.
 *
 * <p>두 경로를 한 엔드포인트가 겸한다:
 * <ul>
 *   <li><b>최초 획득</b> — 바디 없음(또는 {@code claimToken} null). 비어 있거나 리스가 만료된 선점을
 *       가져온다.</li>
 *   <li><b>렌더 직전 재검증 + 리스 연장</b> — 선점 때 받은 토큰을 실어 보낸다. 내 선점이 아직 내
 *       것이면 리스를 <b>같은 쓰기로</b> 밀어 주고 같은 토큰을 돌려준다. 그 사이 리스가 만료돼 다른
 *       기기가 재선점했으면 {@code RESULT_CLAIM_HELD} 로 막는다 — 이게 없으면 정지됐다 깨어난
 *       기기가 <b>낡은 성공 응답만 믿고</b> 모달을 띄워 두 기기가 모두 렌더한다.</li>
 * </ul>
 *
 * <p>바디 없는 기존 호출은 그대로 최초 획득으로 동작한다(additive).
 *
 * @param claimToken 재검증할 선점의 토큰 — null 이면 최초 획득
 */
public record ChallengeResultClaimRequest(UUID claimToken) {
}
