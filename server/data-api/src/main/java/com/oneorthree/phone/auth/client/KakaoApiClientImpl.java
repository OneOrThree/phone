package com.oneorthree.phone.auth.client;

import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.user.repository.domain.Provider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;

@Component
public class KakaoApiClientImpl implements SocialLoginClient {

    private final RestClient restClient;

    public KakaoApiClientImpl(@Value("${kakao.api-base-url}") String baseUrl) {
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .build();
    }

    @Override
    public Provider provider() {
        return Provider.KAKAO;
    }

    @Override
    public String getProviderId(String token) {
        Map<?, ?> body = restClient.get()
                .uri("/v2/user/me")
                .header("Authorization", "Bearer " + token)
                .retrieve()
                .onStatus(HttpStatusCode::is4xxClientError, (req, res) -> {
                    throw new InvalidTokenException(InvalidTokenErrorCode.KAKAO_TOKEN);
                })
                .body(Map.class);

        return String.valueOf(body.get("id"));
    }
}
