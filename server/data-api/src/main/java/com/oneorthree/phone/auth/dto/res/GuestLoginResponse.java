package com.oneorthree.phone.auth.dto.res;

public record GuestLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
