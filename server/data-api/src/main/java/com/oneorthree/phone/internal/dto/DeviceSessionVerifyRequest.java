package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code deviceBootstrap} 세션 확인 요청 (A22 ㋤).
 *
 * <p>GET 이 아닌 이유: 자격 문자열을 쿼리에 실으면 접근 로그·프록시 캐시에 남는다. 상태를 바꾸지
 * 않으므로 재시도는 안전하다.
 *
 * @param deviceBootstrap 그 로그인 세션에서 발급된 1회용 자격
 */
public record DeviceSessionVerifyRequest(
        @NotBlank @Size(max = 512) String deviceBootstrap) {
}
