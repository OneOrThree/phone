package com.oneorthree.phone.internal.dto;

/**
 * 세션 확인 결과 + fencing 값 (A22 ㋤ · ㋨).
 *
 * <p><b>{@code active=false} 일 때도 마지막 {@code sessionEpoch} 를 채운다.</b> 그 값이 알림 서버
 * tombstone 비교의 기준이라, 0 을 주면 이미 끝난 세션의 지연 등록이 「가장 오래된 값」으로 통과한다.
 *
 * @param active       그 세션이 아직 활성인가
 * @param sessionEpoch 원자 대조에 쓸 단조 fencing 값
 */
public record DeviceSessionVerifyResponse(boolean active, long sessionEpoch) {
}
