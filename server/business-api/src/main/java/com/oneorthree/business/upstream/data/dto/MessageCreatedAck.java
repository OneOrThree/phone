package com.oneorthree.business.upstream.data.dto;

/**
 * {@code message.created} 적재의 최소 완료 증거. 로그·지표에만 쓴다 — 공개 응답에 싣지 않는다.
 *
 * @param eventId {@code message.created:<messageId>}
 * @param version 언제나 1(메시지는 불변)
 */
public record MessageCreatedAck(String eventId, long version) {
}
