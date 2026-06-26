package com.oneorthree.phone.auth.client;

import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.user.domain.Provider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;

@Component
public class InstagramApiClientImpl implements SocialLoginClient {

    private final RestClient restClient;

    public InstagramApiClientImpl(@Value("${instagram.api-base-url}") String baseUrl) {
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .build();
    }

    @Override
    public Provider provider() {
        return Provider.INSTAGRAM;
    }

    @Override
    public String getProviderId(String token) {
        // Instagram Graph는 Bearer 헤더가 아니라 access_token 쿼리 파라미터를 사용한다.
        Map<?, ?> body = restClient.get()
                .uri(uriBuilder -> uriBuilder.path("/me")
                        .queryParam("fields", "id")
                        .queryParam("access_token", token)
                        .build())
                .retrieve()
                .onStatus(HttpStatusCode::is4xxClientError, (req, res) -> {
                    throw new InvalidTokenException(InvalidTokenErrorCode.INSTAGRAM_TOKEN);
                })
                .body(Map.class);

        return String.valueOf(body.get("id"));
    }
}
