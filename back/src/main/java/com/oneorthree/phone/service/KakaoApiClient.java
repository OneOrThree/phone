package com.oneorthree.phone.service;

import com.oneorthree.phone.service.dto.user.KakaoUserInfo;

public interface KakaoApiClient {
    KakaoUserInfo getUserInfo(String accessToken);
}
