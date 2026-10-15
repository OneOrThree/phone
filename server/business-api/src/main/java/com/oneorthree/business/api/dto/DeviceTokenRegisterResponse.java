package com.oneorthree.business.api.dto;

/**
 * 등록 응답 — <b>기존 계약은 본문 없는 204 였다</b>. 그래서 이 응답은 «추가»이고, 구 앱은 본문을
 * 읽지 않으므로 깨지지 않는다(additive).
 *
 * <p>{@code ownershipToken} 을 돌려주는 이유는 A22 ㊚ 다 — 서버 행에만 소유권 값을 두면 「늦게 도착한
 * A 등록」과 「정상적인 B→A 재이관」을 구분할 수 없다.
 *
 * @param ownershipToken 다음 등록·삭제 요청에 실을 CAS 값
 */
public record DeviceTokenRegisterResponse(String ownershipToken) {
}
