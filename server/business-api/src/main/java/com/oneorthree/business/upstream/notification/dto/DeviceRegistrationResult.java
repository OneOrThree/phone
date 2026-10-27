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
 * @param deliveryTag    이 등록의 수신 확인 태그(GROMO-2520) — 이 기기로 가는 모든 푸시 data 의 {@code deliveryTag}.
 *                       <b>없어도 정상이다</b>: 알림 서버 V13 전에 저장된 등록 응답은 같은 키로 탈퇴 전까지 재생되므로
 *                       부재는 일시 상태가 아니다. 여기서 거절하면 그 키의 재시도가 영구 502 가 되고 앱은 새
 *                       {@code ownershipToken} 까지 잃는다 — 그래서 필수·형식 검사를 두지 않는다
 */
public record DeviceRegistrationResult(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String ownershipToken,
        String deliveryTag) {
}
