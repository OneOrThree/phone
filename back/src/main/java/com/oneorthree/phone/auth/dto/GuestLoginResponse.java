package com.oneorthree.phone.api.dto.response;

public record GuestLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
