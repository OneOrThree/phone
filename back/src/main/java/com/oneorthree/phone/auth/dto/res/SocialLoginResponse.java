package com.oneorthree.phone.auth.dto.res;

public record SocialLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
