package com.oneorthree.phone.auth.dto;

public record GuestLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
