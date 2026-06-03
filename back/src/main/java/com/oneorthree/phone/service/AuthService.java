package com.oneorthree.phone.service;

import com.oneorthree.phone.api.dto.response.KakaoLoginResponse;
import com.oneorthree.phone.api.dto.response.TokenRefreshResponse;
import com.oneorthree.phone.domain.user.Provider;
import com.oneorthree.phone.domain.user.SocialAccount;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.exception.InvalidRefreshTokenException;
import com.oneorthree.phone.repository.user.SocialAccountRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import com.oneorthree.phone.service.dto.KakaoUserInfo;
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

        KakaoUserInfo userInfo = kakaoApiClient.getUserInfo(kakaoAccessToken);

        Optional<SocialAccount> socialUser =
                socialAccountRepository.findByProviderAndProviderId(
                        Provider.KAKAO,
                        String.valueOf(userInfo.providerId())
                );

        boolean isNewUser = socialUser.isEmpty();

        User user = socialUser
                .map(SocialAccount::getUser)
                .orElseGet(() -> {
                    User newUser = userRepository.save(User.builder().build());
                    socialAccountRepository.save(SocialAccount.builder()
                                    .user(newUser)
                                    .provider(Provider.KAKAO)
                                    .providerId(String.valueOf(userInfo.providerId()))
                                    .build());
                    return newUser;
                });

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
