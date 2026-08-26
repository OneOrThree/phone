package com.oneorthree.phone.auth.dto.rep;

public record AppleLoginRequest(String identityToken, String authorizationCode, String fullName) {
}
