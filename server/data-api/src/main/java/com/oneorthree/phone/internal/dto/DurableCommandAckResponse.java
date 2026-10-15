package com.oneorthree.phone.internal.dto;

import java.util.UUID;
import java.util.Map;
import java.util.Collections;
import java.util.TreeMap;

/**
 * 내구 명령의 <b>완성된 봉투</b> (A22 ㉵).
 *
 * <p>Business 에는 DB 가 없어 outbox 행을 다시 읽을 수 없다. {@code eventId} 만 주면 요청형 이벤트의
 * 정본 봉투를 구성할 수 없으므로(필수 필드가 빈다) {@code version} 까지 채워서 준다.
 *
 * @param commandId 직접 전달 성공 시 완료 표시할 대상(㊿) — outbox 봉투 id 또는 내구 큐 항목 id
 * @param eventId   불변 사건 식별자 — 위성의 dedup 기준
 * @param version   aggregate 행 잠금 아래 발급된 단조 version(㊸) — 위성의 역순 거부 기준
 */
public record DurableCommandAckResponse(UUID commandId, String eventId, long version, Map<String, Object> params) {
    public DurableCommandAckResponse {
        params = params == null ? null : Collections.unmodifiableMap(new TreeMap<>(params));
    }

    public DurableCommandAckResponse(UUID commandId, String eventId, long version) {
        this(commandId, eventId, version, null);
    }
}
