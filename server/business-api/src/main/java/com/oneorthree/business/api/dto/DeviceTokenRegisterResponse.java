package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 등록 응답 — <b>기존 계약은 본문 없는 204 였다</b>. 그래서 이 응답은 «추가»이고, 구 앱은 본문을
 * 읽지 않으므로 깨지지 않는다(additive).
 *
 * <p>{@code ownershipToken} 을 돌려주는 이유는 A22 ㊚ 다 — 서버 행에만 소유권 값을 두면 「늦게 도착한
 * A 등록」과 「정상적인 B→A 재이관」을 구분할 수 없다.
 *
 * @param ownershipToken 다음 등록·삭제 요청에 실을 CAS 값
 * @param deliveryTag    이 등록의 수신 확인 태그(GROMO-2520) — 이 기기로 가는 모든 푸시 data 의 {@code deliveryTag}
 *                       와 같다. 알림 서버가 주지 않았으면(V13 전에 저장된 등록 응답의 재생) 키를 생략한다
 */
public record DeviceTokenRegisterResponse(
        String ownershipToken,
        @JsonInclude(JsonInclude.Include.NON_NULL) String deliveryTag) {
}
