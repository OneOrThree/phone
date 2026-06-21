package com.oneorthree.phone.api.dto.request;

public record AppleLoginRequest(String identityToken, String authorizationCode, String fullName) {
}
