package com.oneorthree.phone.service;

import com.oneorthree.phone.exception.InvalidTokenException;
import com.oneorthree.phone.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.service.dto.user.KakaoUserInfo;
import com.oneorthree.phone.service.dto.user.KakaoUserMeResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class KakaoApiClientImpl implements KakaoApiClient {

    private final RestClient restClient;

    public KakaoApiClientImpl(@Value("${kakao.api-base-url}") String baseUrl) {

        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .build();
    }

    @Override
    public KakaoUserInfo getUserInfo(String accessToken) {

        KakaoUserMeResponse response = restClient.get()
                .uri("/v2/user/me")
                .header("Authorization", "Bearer " + accessToken)
                .retrieve()
                .onStatus(HttpStatusCode::is4xxClientError, (req, res) -> {
                    throw new InvalidTokenException(InvalidTokenErrorCode.KAKAO_TOKEN);
                })
                .body(KakaoUserMeResponse.class);

        return new KakaoUserInfo(response.id());
    }
}
