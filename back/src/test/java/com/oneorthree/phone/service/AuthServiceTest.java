package com.oneorthree.phone.service;

import com.oneorthree.phone.repository.user.SocialAccountRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
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
@Disabled
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
        // TODO: 구현 후 주석 해제
        // given
        // KakaoUserInfo kakaoInfo = new KakaoUserInfo("12345", "홍길동", "https://profile.img");
        // given(kakaoApiClient.getUserInfo("kakao-token")).willReturn(kakaoInfo);
        // given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
        //         .willReturn(Optional.empty());
        // User savedUser = User.builder().build();
        // given(userRepository.save(any(User.class))).willReturn(savedUser);
        // given(jwtProvider.generateAccessToken(any())).willReturn("access-token");
        // given(jwtProvider.generateRefreshToken(any())).willReturn("refresh-token");
        //
        // when
        // KakaoLoginResponse response = authService.kakaoLogin("kakao-token");
        //
        // then
        // assertThat(response.isNewUser()).isTrue();
        // assertThat(response.accessToken()).isEqualTo("access-token");
        // assertThat(response.refreshToken()).isEqualTo("refresh-token");
        // verify(userRepository).save(any(User.class));
        // verify(socialAccountRepository).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("기존 유저 카카오 로그인 → isNewUser=false, DB 저장 없음")
    void kakaoLoginExistingUser() {
        // TODO: 구현 후 주석 해제
        // given
        // KakaoUserInfo kakaoInfo = new KakaoUserInfo("12345", "홍길동", "https://profile.img");
        // given(kakaoApiClient.getUserInfo("kakao-token")).willReturn(kakaoInfo);
        // User existingUser = User.builder().build();
        // SocialAccount existingAccount = SocialAccount.builder()
        //         .user(existingUser).provider(Provider.KAKAO).providerId("12345").build();
        // given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
        //         .willReturn(Optional.of(existingAccount));
        // given(jwtProvider.generateAccessToken(any())).willReturn("access-token");
        // given(jwtProvider.generateRefreshToken(any())).willReturn("refresh-token");
        //
        // when
        // KakaoLoginResponse response = authService.kakaoLogin("kakao-token");
        //
        // then
        // assertThat(response.isNewUser()).isFalse();
        // verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("카카오 API 실패 → InvalidKakaoTokenException 전파")
    void kakaoLoginInvalidKakaoToken() {
        // TODO: 구현 후 주석 해제
        // given(kakaoApiClient.getUserInfo("bad-token")).willThrow(new InvalidKakaoTokenException());
        //
        // assertThatThrownBy(() -> authService.kakaoLogin("bad-token"))
        //         .isInstanceOf(InvalidKakaoTokenException.class);
    }

    @Test
    @DisplayName("유효한 RT로 토큰 갱신 → 새 AT 반환")
    void refreshTokenSuccess() {
        // TODO: 구현 후 주석 해제
        // given(jwtProvider.extractUserId("valid-rt")).willReturn(1L);
        // given(userRepository.findByRefreshToken("valid-rt")).willReturn(Optional.of(User.builder().build()));
        // given(jwtProvider.generateAccessToken(any())).willReturn("new-access-token");
        //
        // TokenRefreshResponse response = authService.refreshToken("valid-rt");
        //
        // assertThat(response.accessToken()).isEqualTo("new-access-token");
    }

    @Test
    @DisplayName("유효하지 않은 RT → InvalidRefreshTokenException")
    void refreshTokenInvalid() {
        // TODO: 구현 후 주석 해제
        // given(jwtProvider.extractUserId("bad-rt")).willThrow(new JwtException("invalid"));
        //
        // assertThatThrownBy(() -> authService.refreshToken("bad-rt"))
        //         .isInstanceOf(InvalidRefreshTokenException.class);
    }

    @Test
    @DisplayName("DB에 없는 RT → InvalidRefreshTokenException")
    void refreshTokenNotFoundInDb() {
        // TODO: 구현 후 주석 해제
        // given(jwtProvider.extractUserId("orphan-rt")).willReturn(1L);
        // given(userRepository.findByRefreshToken("orphan-rt")).willReturn(Optional.empty());
        //
        // assertThatThrownBy(() -> authService.refreshToken("orphan-rt"))
        //         .isInstanceOf(InvalidRefreshTokenException.class);
    }
}
