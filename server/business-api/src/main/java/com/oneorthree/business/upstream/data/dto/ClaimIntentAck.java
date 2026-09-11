package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

/**
 * 요청 키별 claim 의도의 내구 응답. 이미 종결된 같은 요청은 하위 서비스를 다시 호출하지 않는다.
 *
 * @param commandId 의도 식별자
 * @param eventId 요청 키별 사건 식별자
 * @param version 내구 적재 version
 * @param completed 이 요청이 이미 확정 또는 대상 없음으로 종결됐는가
 */
public record ClaimIntentAck(UUID commandId, String eventId, long version, boolean completed) {
}
