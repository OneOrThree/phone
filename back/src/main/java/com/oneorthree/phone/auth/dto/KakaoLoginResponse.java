package com.oneorthree.phone.auth.dto;

public record KakaoLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
