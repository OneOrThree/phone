package com.oneorthree.phone.service;

import com.oneorthree.phone.api.dto.response.KakaoLoginResponse;
import com.oneorthree.phone.api.dto.response.TokenRefreshResponse;
import com.oneorthree.phone.domain.Provider;
import com.oneorthree.phone.domain.SocialAccount;
import com.oneorthree.phone.domain.User;
import com.oneorthree.phone.exception.InvalidKakaoTokenException;
import com.oneorthree.phone.exception.InvalidRefreshTokenException;
import com.oneorthree.phone.repository.SocialAccountRepository;
import com.oneorthree.phone.repository.UserRepository;
import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @InjectMocks
    private AuthService authService;

    @Mock
    private KakaoApiClient kakaoApiClient;

    @Mock
    private UserRepository userRepository;

    @Mock
    private SocialAccountRepository socialAccountRepository;

    @Mock
    private JwtProvider jwtProvider;

    @Test
    @DisplayName("신규 유저 카카오 로그인 → isNewUser=true, User+SocialAccount 생성")
    void kakaoLoginNewUser() {
        KakaoUserInfo kakaoInfo = new KakaoUserInfo("12345", "홍길동", "https://profile.img");
        given(kakaoApiClient.getUserInfo("kakao-token")).willReturn(kakaoInfo);
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        User savedUser = User.builder().build();
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(any())).willReturn("refresh-token");

        KakaoLoginResponse response = authService.kakaoLogin("kakao-token");

        assertThat(response.isNewUser()).isTrue();
        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(response.refreshToken()).isEqualTo("refresh-token");
        verify(userRepository).save(any(User.class));
        verify(socialAccountRepository).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("기존 유저 카카오 로그인 → isNewUser=false, 기존 User 반환")
    void kakaoLoginExistingUser() {
        KakaoUserInfo kakaoInfo = new KakaoUserInfo("12345", "홍길동", "https://profile.img");
        given(kakaoApiClient.getUserInfo("kakao-token")).willReturn(kakaoInfo);
        User existingUser = User.builder().build();
        SocialAccount existingAccount = SocialAccount.builder()
                .user(existingUser)
                .provider(Provider.KAKAO)
                .providerId("12345")
                .build();
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(existingAccount));
        given(jwtProvider.generateAccessToken(any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(any())).willReturn("refresh-token");

        KakaoLoginResponse response = authService.kakaoLogin("kakao-token");

        assertThat(response.isNewUser()).isFalse();
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("카카오 API 실패 시 InvalidKakaoTokenException 전파")
    void kakaoLoginInvalidKakaoToken() {
        given(kakaoApiClient.getUserInfo("bad-token"))
                .willThrow(new InvalidKakaoTokenException());

        assertThatThrownBy(() -> authService.kakaoLogin("bad-token"))
                .isInstanceOf(InvalidKakaoTokenException.class);
    }

    @Test
    @DisplayName("유효한 RT로 토큰 갱신 → 새 Access Token 반환")
    void refreshTokenSuccess() {
        User user = User.builder().build();
        given(jwtProvider.extractUserId("valid-rt")).willReturn(1L);
        given(userRepository.findByRefreshToken("valid-rt")).willReturn(Optional.of(user));
        given(jwtProvider.generateAccessToken(any())).willReturn("new-access-token");

        TokenRefreshResponse response = authService.refreshToken("valid-rt");

        assertThat(response.accessToken()).isEqualTo("new-access-token");
    }

    @Test
    @DisplayName("JWT 서명 오류 RT → InvalidRefreshTokenException")
    void refreshTokenInvalidSignature() {
        given(jwtProvider.extractUserId("bad-rt")).willThrow(new JwtException("invalid"));

        assertThatThrownBy(() -> authService.refreshToken("bad-rt"))
                .isInstanceOf(InvalidRefreshTokenException.class);
    }

    @Test
    @DisplayName("DB에 없는 RT → InvalidRefreshTokenException")
    void refreshTokenNotFoundInDb() {
        given(jwtProvider.extractUserId("orphan-rt")).willReturn(1L);
        given(userRepository.findByRefreshToken("orphan-rt")).willReturn(Optional.empty());

        assertThatThrownBy(() -> authService.refreshToken("orphan-rt"))
                .isInstanceOf(InvalidRefreshTokenException.class);
    }
}
