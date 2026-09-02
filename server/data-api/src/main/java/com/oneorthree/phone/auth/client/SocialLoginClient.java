package com.oneorthree.phone.auth.client;

import com.oneorthree.phone.user.repository.domain.Provider;

/**
 * 소셜 로그인 제공자별 토큰 검증 어댑터. 구현체는 두 계열이다 —
 * OIDC id_token 을 JWKS 공개키로 <b>로컬 검증</b>하는 쪽(Apple·Google·Facebook)과,
 * 액세스 토큰을 들고 제공자 프로필 API 를 <b>호출</b>해 확인하는 쪽(Kakao·Line·Instagram)이다.
 *
 * <p>{@code AuthService} 는 구현체를 직접 참조하지 않고 {@link #provider()} 로 골라 쓴다.
 * 새 제공자를 붙일 때 필요한 건 이 인터페이스 구현체 하나를 빈으로 올리는 것뿐이다.
 */
public interface SocialLoginClient {
    /**
     * 구현체가 담당하는 Provider 반환
     *
     * @return 이 구현체가 검증할 수 있는 제공자. 라우팅 키이므로 구현체마다 서로 달라야 하고,
     *         겹치면 어느 쪽이 선택될지 보장되지 않는다
     */
    Provider provider();

    /**
     * 토큰 검증 후 Provider 고유 식별자 반환
     *
     * @param token 앱이 제공자 SDK 에서 받아 그대로 넘긴 토큰. OIDC 계열은 id_token,
     *              프로필 API 계열은 액세스 토큰이다
     * @return 제공자 안에서 유일한 유저 식별자. {@code users.provider_id} 로 저장돼 재로그인 시
     *         같은 계정을 찾는 키가 되므로, 제공자가 재발급하지 않는 안정적인 값이어야 한다
     * @throws com.oneorthree.phone.auth.exception.InvalidTokenException 토큰이 위조·만료됐거나
     *         우리 앱이 아닌 다른 클라이언트용으로 발급된 경우
     */
    String getProviderId(String token);
}
