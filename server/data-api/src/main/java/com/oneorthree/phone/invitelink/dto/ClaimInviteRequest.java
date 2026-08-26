package com.oneorthree.phone.invitelink.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * claim 요청 (스펙 §4-2 ④) — 가입/로그인 직후 앱이 보관 중인 slug 로 한 번 호출한다.
 *
 * @param slug 매치나 링크 진입으로 앱이 알고 있는 초대 링크 식별자
 */
public record ClaimInviteRequest(@NotBlank @Size(max = 12) String slug) {
}
