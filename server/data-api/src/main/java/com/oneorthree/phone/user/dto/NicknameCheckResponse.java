package com.oneorthree.phone.user.dto;

/**
 * 닉네임 사용 가능 여부 응답 (GROMO-1215).
 * 형식 위반(trim 후 2~10자 밖·빈문자열)도 available=false 로 내려간다 — 별도 4xx 없이 항상 200.
 */
public record NicknameCheckResponse(boolean available) {
}
