package com.oneorthree.phone.service;

import com.oneorthree.phone.api.dto.response.KakaoLoginResponse;
import com.oneorthree.phone.api.dto.response.TokenRefreshResponse;
import com.oneorthree.phone.domain.Provider;
import com.oneorthree.phone.domain.SocialAccount;
import com.oneorthree.phone.domain.User;
import com.oneorthree.phone.exception.InvalidRefreshTokenException;
import com.oneorthree.phone.repository.SocialAccountRepository;
import com.oneorthree.phone.repository.UserRepository;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {

    private final KakaoApiClient kakaoApiClient;
    private final UserRepository userRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final JwtProvider jwtProvider;

    @Transactional
    public KakaoLoginResponse kakaoLogin(String kakaoAccessToken) {
        KakaoUserInfo kakaoInfo = kakaoApiClient.getUserInfo(kakaoAccessToken);
        String providerId = kakaoInfo.providerId();

        Optional<SocialAccount> existingAccount =
            socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, providerId);

        boolean isNewUser = existingAccount.isEmpty();
        User user;

        if (isNewUser) {
            user = userRepository.save(User.builder().build());
            socialAccountRepository.save(SocialAccount.builder()
                .user(user)
                .provider(Provider.KAKAO)
                .providerId(providerId)
                .build());
        } else {
            user = existingAccount.get().getUser();
        }

        String accessToken = jwtProvider.generateAccessToken(user.getId());
        String refreshToken = jwtProvider.generateRefreshToken(user.getId());
        user.setRefreshToken(refreshToken);

        return new KakaoLoginResponse(accessToken, refreshToken, isNewUser);
    }

    public TokenRefreshResponse refreshToken(String refreshToken) {
        try {
            jwtProvider.extractUserId(refreshToken);
        } catch (JwtException e) {
            throw new InvalidRefreshTokenException();
        }

        User user = userRepository.findByRefreshToken(refreshToken)
            .orElseThrow(InvalidRefreshTokenException::new);

        String newAccessToken = jwtProvider.generateAccessToken(user.getId());
        return new TokenRefreshResponse(newAccessToken);
    }
}
