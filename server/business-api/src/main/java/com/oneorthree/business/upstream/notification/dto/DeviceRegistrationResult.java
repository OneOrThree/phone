package com.oneorthree.business.upstream.notification.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 등록 응답 — <b>매번 새 {@code ownershipToken} 을 준다</b>(A22 ㊚).
 *
 * <p>서버 행에만 소유권 값을 두면 「B 가 인수한 뒤 늦게 도착한 A 등록」과 「정상적인 B→A 재이관」이
 * 입력이 같아져, 거부하면 실제 계정 전환이 막히고 수락하면 지연 요청이 토큰을 도로 빼앗는다.
 * 그래서 값을 <b>요청에도 실어</b> CAS 한다 — 그 값을 여기서 발급한다.
 *
 * @param ownershipToken 다음 등록·삭제 요청에 실을 CAS 값
 */
public record DeviceRegistrationResult(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String ownershipToken) {
}
