package com.oneorthree.phone.auth.dto.res;

/**
 * 토큰 재발급 응답.
 *
 * <p>{@code refreshToken} 은 <b>회전이 일어난 경우에만</b> 채워진다 (GROMO-1509). 남은 수명이
 * 넉넉하면 null 이고, 클라이언트는 값이 있을 때만 저장소를 갱신한다(앱 {@code api.ts} 의
 * {@code if (data.refreshToken)}). 매 갱신마다 갈아끼우지 않는 이유는
 * {@code JwtProvider.isRefreshRotationDue} 주석 참고.
 */
public record TokenRefreshResponse(String accessToken, String refreshToken) {
}
