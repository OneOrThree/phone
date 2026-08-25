package com.oneorthree.phone.auth.client;

import com.oneorthree.phone.user.domain.Provider;

public interface SocialLoginClient {
    /**
     * 구현체가 담당하는 Provider 반환
     */
    Provider provider();

    /**
     * 토큰 검증 후 Provider 고유 식별자 반환
     */
    String getProviderId(String token);
}
