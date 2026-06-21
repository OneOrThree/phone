package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.dto.AppleLoginResponse;
import com.oneorthree.phone.auth.dto.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.KakaoLoginResponse;
import com.oneorthree.phone.auth.dto.TokenRefreshResponse;
import com.oneorthree.phone.auth.client.AppleJwksClient;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.auth.client.KakaoApiClient;
import com.oneorthree.phone.user.dto.KakaoUserInfo;
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
    private final AppleJwksClient appleJwksClient;

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

    @Transactional
    public AppleLoginResponse appleLogin(String identityToken, String fullName) {

        String sub = appleJwksClient.extractSubject(identityToken);

        Optional<SocialAccount> socialUser =
                socialAccountRepository.findByProviderAndProviderId(Provider.APPLE, sub);

        boolean isNewUser = socialUser.isEmpty();

        User user = socialUser
                .map(SocialAccount::getUser)
                .orElseGet(() -> {
                    User newUser = userRepository.save(User.builder().build());
                    if (fullName != null) {
                        newUser.setNickname(fullName);
                    }
                    socialAccountRepository.save(SocialAccount.builder()
                            .user(newUser)
                            .provider(Provider.APPLE)
                            .providerId(sub)
                            .build());
                    return newUser;
                });

        String accessToken = jwtProvider.generateAccessToken(user.getId());
        String refreshToken = jwtProvider.generateRefreshToken(user.getId());

        user.setRefreshToken(refreshToken);
        return new AppleLoginResponse(accessToken, refreshToken, isNewUser);
    }

    @Transactional
    public GuestLoginResponse guestLogin() {
        User newUser = userRepository.save(User.builder().isGuest(true).build());

        String accessToken = jwtProvider.generateAccessToken(newUser.getId());
        String refreshToken = jwtProvider.generateRefreshToken(newUser.getId());
        newUser.setRefreshToken(refreshToken);

        return new GuestLoginResponse(accessToken, refreshToken, newUser.isGuest());
    }

    public TokenRefreshResponse refreshToken(String refreshToken) {
        try {
            jwtProvider.extractUserId(refreshToken);
        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        User user = userRepository.findByRefreshToken(refreshToken)
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));

        String newAccessToken = jwtProvider.generateAccessToken(user.getId());
        return new TokenRefreshResponse(newAccessToken);
    }

    @Transactional
    public void logout(String refreshToken) {
        try {
            jwtProvider.extractUserId(refreshToken);
        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        User user = userRepository.findByRefreshToken(refreshToken)
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));

        user.setRefreshToken(null);
    }
}
