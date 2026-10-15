package com.oneorthree.phone.internal.dto;

/**
 * 적재된 봉투의 최소 완료 증거.
 *
 * @param eventId 결정적 사건 키 — {@code message.created:<messageId>}
 * @param version 순서 축 버전. 메시지는 불변이라 언제나 1 이다
 */
public record MessageCreatedResponse(String eventId, long version) {
}
