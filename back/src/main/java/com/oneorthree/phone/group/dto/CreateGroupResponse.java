package com.oneorthree.phone.group.dto;

import java.util.UUID;

/**
 * 그룹 생성 응답.
 *
 * <p>{@code code} 는 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31). 앱은 이 값을 무시한다.
 * 필드를 제거하면 계약이 깨지므로 남긴다.
 */
public record CreateGroupResponse(UUID groupId, String code) {
}
