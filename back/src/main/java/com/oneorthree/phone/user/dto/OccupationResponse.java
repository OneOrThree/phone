package com.oneorthree.phone.user.dto;

/**
 * GET /api/v1/occupations 응답 1건 — occupation 코드·표시명·노출 순서.
 *
 * <p>{@code code} 는 {@link com.oneorthree.phone.user.domain.Occupation} enum name 문자열이며,
 * 온보딩 등에서 {@code users.occupation} 으로 그대로 넘겨 사용한다. {@code displayName} 은
 * 그동안 앱에서 하드코딩하던 표시명을 서버가 제공하는 값.
 */
public record OccupationResponse(String code, String displayName, int sortOrder) {
}
