package com.oneorthree.phone.auth.client;

import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.user.repository.domain.Provider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * 카카오 액세스 토큰을 카카오 프로필 API 로 <b>왕복 검증</b>한다 — JWKS 로컬 검증을 쓰는
 * Apple·Google·Facebook 과 달리, 토큰 자체를 해석하지 않고 카카오 에게 "이 토큰의 주인이 누구냐"를 묻는다.
 * 따라서 매 로그인이 외부 API 호출 1회에 의존하며, 카카오 이 응답하지 않으면 이 제공자 로그인만 멎는다.
 *
 * <p>토큰은 Authorization: Bearer 헤더로 실어 {@code /v2/user/me} 를 부르고 응답의 {@code id} 를 식별자로 삼는다.
 * 4xx 는 모두 {@link InvalidTokenErrorCode#KAKAO_TOKEN} 로 접어 만료·위조·권한 부족을 구분하지 않는다.
 * 5xx 와 네트워크 장애는 잡지 않는다 — 우리 잘못이 아닌 일시 장애를 "토큰이 무효하다"로 바꿔
 * 클라이언트를 재로그인시키면 안 되기 때문이다.
 */
@Component
public class KakaoApiClientImpl implements SocialLoginClient {

    private final RestClient restClient;

    /**
     * @param baseUrl {@code kakao.api-base-url} — 카카오 프로필 API 의 호스트. 프로파일별로
     *                갈아끼울 수 있게 상수가 아니라 설정값이며, 여기를 잘못 가리키면 검증이
     *                통째로 무력해지므로 신뢰할 수 있는 카카오 도메인이어야 한다
     */
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
