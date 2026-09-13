package com.oneorthree.phone.internal.dto;

/**
 * claim 의도 종결 요청 — <b>왜 종결하는가</b>를 함께 싣는다.
 *
 * <p>본문 자체가 선택이다. 「붙일 대상이 없었다」는 판정이 아니라 정상 종결이므로 코드를 싣지 않고,
 * 그 부재가 곧 「이 종결은 200 으로 재생된다」는 뜻이다.
 *
 * <p>코드가 실리면 원장이 그것을 보존하고, 같은 요청 키로 다시 온 요청에 <b>첫 요청이 받았던 판정</b>을
 * 그대로 재생한다. 없으면 {@code completed} 불리언 하나가 「정상 확정·대상 없음」과 「상류가 내린
 * 거절」을 뭉쳐, 첫 요청은 4xx 인데 재시도는 200 이 되는 멱등 계약 위반이 생긴다.
 *
 * @param terminalCode 상류가 내린 종결 판정 코드. 정상 종결이면 {@code null}
 */
public record ClaimIntentAbandonRequest(String terminalCode) {
}
