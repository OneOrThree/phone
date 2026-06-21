package com.oneorthree.phone.auth.client;

import com.oneorthree.phone.user.dto.KakaoUserInfo;

public interface KakaoApiClient {
    KakaoUserInfo getUserInfo(String accessToken);
}
