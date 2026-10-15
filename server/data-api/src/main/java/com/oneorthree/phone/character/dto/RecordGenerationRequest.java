package com.oneorthree.phone.character.dto;

import java.util.UUID;

/**
 * 누끼(캐릭터) 생성 1건 기록 요청 (POST /api/v1/character/generation).
 *
 * <p>body 전체가 옵션이다. {@code clientGenerationId} 는 멱등키(옵션) — 있으면 재시도 시 같은 생성이 2슬롯을
 * 소비하지 않도록 (user, key) 중복을 무시한다. 없으면(키를 안 보내는 현행 클라) 기존대로 기록한다.
 *
 * @param clientGenerationId 클라 멱등키(uuid, nullable)
 */
public record RecordGenerationRequest(
        UUID clientGenerationId
) {
}
