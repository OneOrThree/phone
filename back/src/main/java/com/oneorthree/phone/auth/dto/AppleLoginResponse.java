package com.oneorthree.phone.api.dto.response;

public record AppleLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
