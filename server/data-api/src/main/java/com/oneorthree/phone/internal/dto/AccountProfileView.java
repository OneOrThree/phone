package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 공개 {@code PATCH /me} 의 상류 응답 — 변경 뒤 4필드만 (GROMO-1801·1971 · 계정 LLD §2.3).
 * {@code onboardingComplete} 는 싣지 않는다. 이 값이 그대로 receipt 에 저장돼 같은 키 재생에 쓰인다.
 *
 * @param id       사용자 UUID
 * @param name     변경 뒤 닉네임
 * @param catColor 변경 뒤 고양이 색. 미선택이면 null
 * @param mainIslandId 변경 뒤 메인 섬. 소속이 하나도 없으면 null
 */
public record AccountProfileView(UUID id, String name, String catColor, UUID mainIslandId) {
}
