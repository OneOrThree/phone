package com.oneorthree.phone.focus.dto;

import com.oneorthree.phone.user.repository.domain.Occupation;

import java.util.List;

/**
 * GET /api/v1/tag/defaults 응답 — 조회에 사용된 occupation + 기본 태그 목록.
 *
 * <p>occupation 은 요청 파라미터로 받았으면 그 값, 미지정이면 서버가 로그인 유저의 저장 occupation 을
 * 해석한 값이다(어느 occupation 기준인지 클라이언트가 알 수 있게 함께 반환).
 */
public record OccupationDefaultTagsResponse(Occupation occupation, List<OccupationDefaultTagResponse> tags) {
}
