package com.oneorthree.phone.api.dto.response;

public record KakaoLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
