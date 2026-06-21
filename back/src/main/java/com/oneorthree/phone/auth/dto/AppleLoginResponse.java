package com.oneorthree.phone.auth.dto;

public record AppleLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
