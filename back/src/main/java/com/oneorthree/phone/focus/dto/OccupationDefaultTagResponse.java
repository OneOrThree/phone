package com.oneorthree.phone.focus.dto;

/**
 * occupation별 기본(추천) 태그 1건.
 *
 * <p>유저 소유 태그가 아니므로 {@code tagId} 를 포함하지 않는다
 * (대비: {@link FocusTagResponse} 는 tagId 포함). 유저가 선택 시 {@code name} 을
 * {@code POST /api/v1/tag} body 로 그대로 넘겨 실제 태그를 생성한다.
 */
public record OccupationDefaultTagResponse(String name, int sortOrder) {
}
