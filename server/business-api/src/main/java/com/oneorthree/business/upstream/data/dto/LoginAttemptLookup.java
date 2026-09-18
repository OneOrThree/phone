package com.oneorthree.business.upstream.data.dto;

/**
 * 제공자 교환 전 내구 시도 조회의 결과 (계정 LLD §3-2).
 *
 * <p>{@code replayable=true} 면 원 201 을 그대로 재생하고, <b>제공자 교환 표면을 부르지 않는다</b>.
 * 그 「부르지 않음」이 이 계약의 전부다 — 일회용 code 를 두 번 쓰지 않는 것.
 *
 * @param replayable 저장된 결과가 있는가
 * @param session    재생할 결과. {@code replayable=false} 면 null
 */
public record LoginAttemptLookup(boolean replayable, LoginSession session) {
}
