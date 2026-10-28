package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * {@code PUT /internal/users/{userId}/current-island} 요청 본문 (GROMO-1759, LLD §3.6).
 *
 * <p>원본에 없는 {@code expectedVersion} 을 더하지 않는다(LLD §2 "원본에 없는 expectedVersion 을
 * 일괄 추가하지 않는다") — 동시성은 서버의 조건부 전이와 잠금이 담당한다.
 */
public record SwitchCurrentIslandCommandRequest(@NotNull UUID islandId) {
}
