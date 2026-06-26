package com.oneorthree.phone.auth.dto;

public record AppleLoginRequest(String identityToken, String authorizationCode, String fullName) {
}
