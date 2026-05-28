package com.oneorthree.phone.service;

import com.fasterxml.jackson.annotation.JsonProperty;

public record KakaoUserMeResponse(
    Long id,
    @JsonProperty("kakao_account") KakaoAccount kakaoAccount
) {
    public record KakaoAccount(KakaoProfile profile) {}

    public record KakaoProfile(
        String nickname,
        @JsonProperty("profile_image_url") String profileImageUrl
    ) {}
}
