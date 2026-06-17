package com.oneorthree.phone.service;

import com.oneorthree.phone.api.dto.response.KakaoLoginResponse;
import com.oneorthree.phone.api.dto.response.TokenRefreshResponse;
import com.oneorthree.phone.domain.user.Provider;
import com.oneorthree.phone.domain.user.SocialAccount;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.exception.InvalidTokenException;
import com.oneorthree.phone.repository.user.SocialAccountRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import com.oneorthree.phone.service.dto.user.KakaoUserInfo;
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

    @Mock
    private AppleJwksClient appleJwksClient;

    // ── kakaoLogin ────────────────────────────────────────────────────────

    @Test
    @DisplayName("신규 유저 카카오 로그인 → isNewUser=true, User+SocialAccount 생성")
    void kakaoLoginNewUser() {
        // given
        KakaoUserInfo userInfo = new KakaoUserInfo(12345L);
        User savedUser = User.builder().id(1L).build();

        given(kakaoApiClient.getUserInfo("kakao-token")).willReturn(userInfo);
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(1L)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(1L)).willReturn("refresh-token");

        // when
        KakaoLoginResponse response = authService.kakaoLogin("kakao-token");

        // then
        assertThat(response.isNewUser()).isTrue();
        assertThat(response.accessToken()).isEqualTo("access-token");
        verify(userRepository).save(any(User.class));
        verify(socialAccountRepository).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("기존 유저 카카오 로그인 → isNewUser=false, DB 저장 없음")
    void kakaoLoginExistingUser() {
        // given
        KakaoUserInfo userInfo = new KakaoUserInfo(12345L);
        User existingUser = User.builder().id(1L).build();
        SocialAccount existingAccount = SocialAccount.builder()
                .user(existingUser).provider(Provider.KAKAO).providerId("12345").build();

        given(kakaoApiClient.getUserInfo("kakao-token")).willReturn(userInfo);
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(existingAccount));
        given(jwtProvider.generateAccessToken(1L)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(1L)).willReturn("refresh-token");

        // when
        KakaoLoginResponse response = authService.kakaoLogin("kakao-token");

        // then
        assertThat(response.isNewUser()).isFalse();
        verify(userRepository, never()).save(any(User.class));
    }

    // ── refreshToken ──────────────────────────────────────────────────────

    @Test
    @DisplayName("유효한 RT로 토큰 갱신 → 새 AT 반환")
    void refreshTokenSuccess() {
        // given
        User user = User.builder().id(1L).build();
        given(userRepository.findByRefreshToken("valid-rt")).willReturn(Optional.of(user));
        given(jwtProvider.generateAccessToken(1L)).willReturn("new-access-token");

        // when
        TokenRefreshResponse response = authService.refreshToken("valid-rt");

        // then
        assertThat(response.accessToken()).isEqualTo("new-access-token");
    }

    @Test
    @DisplayName("유효하지 않은 RT → InvalidTokenException")
    void refreshTokenInvalid() {
        // given
        given(jwtProvider.extractUserId("bad-rt")).willThrow(new JwtException("invalid"));

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("bad-rt"))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("DB에 없는 RT → InvalidTokenException")
    void refreshTokenNotFoundInDb() {
        // given
        given(userRepository.findByRefreshToken("orphan-rt")).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("orphan-rt"))
                .isInstanceOf(InvalidTokenException.class);
    }
}
