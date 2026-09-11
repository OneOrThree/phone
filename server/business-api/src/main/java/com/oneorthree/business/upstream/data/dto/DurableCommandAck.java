package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

/**
 * Data 가 내구 명령(outbox 행)을 커밋하고 돌려주는 <b>완성된 봉투</b> (A22 ㉵).
 *
 * <p>Business 에는 DB 가 없어 outbox 시퀀스를 다시 읽을 수 없다. 그래서 Data 가 {@code eventId} ·
 * {@code version} 까지 채워서 준다 — 그 {@code version} 은 <b>aggregate 행 잠금 아래</b> 발급된 값이고
 * (㊸: 시퀀스는 할당 순서만 보장하고 커밋 순서를 보장하지 않는다) 위성이 역순 적용을 막는 기준이다.
 *
 * @param commandId 이 내구 명령의 식별자. 직접 전달이 성공하면 이 id 로 완료 표시한다(㊿)
 * @param eventId   불변 사건 식별자 — 위성의 dedup 기준
 * @param version   aggregate 락 아래 발급된 단조 version — 위성의 역순 거부 기준
 */
public record DurableCommandAck(UUID commandId, String eventId, long version) {
}
