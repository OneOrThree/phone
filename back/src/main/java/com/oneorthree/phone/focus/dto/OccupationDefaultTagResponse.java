package com.oneorthree.phone.focus.dto;

/**
 * occupation별 기본(추천) 태그 1건.
 *
 * <p>유저 소유 태그가 아니므로 {@code tagId} 를 포함하지 않는다
 * (대비: {@link FocusTagResponse} 는 tagId 포함). 유저가 선택 시 {@code name} 을
 * {@code POST /api/v1/tag} body 로 그대로 넘겨 실제 태그를 채택(생성)한다.
 *
 * <p><b>GROMO-673 소스 변경</b>: {@code occupation_default_tags} 가 이제 {@code default_tags} 를
 * FK 로 참조한다(name 컬럼 제거) → {@code name} 은 참조 default_tag 의 이름이다.
 * JSON 키(name, sortOrder)는 유지된다.
 */
public record OccupationDefaultTagResponse(String name, int sortOrder) {
}
