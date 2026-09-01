package com.oneorthree.phone.auth.dto.req;

public record AppleLoginRequest(String identityToken, String authorizationCode, String fullName) {
}
