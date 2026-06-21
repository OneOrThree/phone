package com.oneorthree.phone.service;

import com.oneorthree.phone.user.dto.KakaoUserInfo;

public interface KakaoApiClient {
    KakaoUserInfo getUserInfo(String accessToken);
}
