package com.oneorthree.phone.service;

import com.oneorthree.phone.exception.InvalidKakaoTokenException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class KakaoApiClientImpl implements KakaoApiClient {

    private final RestClient restClient;

    public KakaoApiClientImpl(@Value("${kakao.api-base-url}") String baseUrl) {
        this.restClient = RestClient.builder().baseUrl(baseUrl).build();
    }

    @Override
    public KakaoUserInfo getUserInfo(String accessToken) {
        KakaoUserMeResponse response = restClient.get()
            .uri("/v2/user/me")
            .header("Authorization", "Bearer " + accessToken)
            .retrieve()
            .onStatus(HttpStatusCode::is4xxClientError, (req, res) -> {
                throw new InvalidKakaoTokenException();
            })
            .body(KakaoUserMeResponse.class);

        String nickname = (response.kakaoAccount() != null && response.kakaoAccount().profile() != null)
            ? response.kakaoAccount().profile().nickname()
            : null;
        String profileImageUrl = (response.kakaoAccount() != null && response.kakaoAccount().profile() != null)
            ? response.kakaoAccount().profile().profileImageUrl()
            : null;

        return new KakaoUserInfo(String.valueOf(response.id()), nickname, profileImageUrl);
    }
}
