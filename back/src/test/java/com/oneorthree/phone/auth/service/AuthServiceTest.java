package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.client.SocialLoginClient;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserWalletRepository userWalletRepository;
    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private SocialAccountRepository socialAccountRepository;
    @Mock
    private JwtProvider jwtProvider;
    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    // provider별 검증 클라이언트 (모킹) — provider()로 Map이 구성된다
    @Mock
    private SocialLoginClient kakaoClient;
    @Mock
    private SocialLoginClient appleClient;

    private AuthService authService;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @BeforeEach
    void setUp() {
        given(kakaoClient.provider()).willReturn(Provider.KAKAO);
        given(appleClient.provider()).willReturn(Provider.APPLE);
        authService = new AuthService(
                userRepository, userWalletRepository, userScreenTimeSettingsRepository,
                userFocusTimeSettingsRepository, userNotificationSettingsRepository,
                socialAccountRepository, jwtProvider, userActivityEventLogger,
                List.of(kakaoClient, appleClient));
    }

    // ── socialLogin ───────────────────────────────────────────────────────

    @Test
    @DisplayName("신규 유저 소셜 로그인 → 올바른 client로 라우팅, User+SocialAccount 생성, isNewUser=true, AT/RT 발급·로깅")
    void socialLoginNewUser() {
        // given
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        SocialLoginResponse response = authService.socialLogin(Provider.KAKAO, "kakao-token", null);

        // then
        assertThat(response.isNewUser()).isTrue();
        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(response.refreshToken()).isEqualTo("refresh-token");
        assertThat(savedUser.getRefreshToken()).isEqualTo("refresh-token");   // setRefreshToken 호출
        verify(userRepository).save(any(User.class));
        verify(socialAccountRepository).save(any(SocialAccount.class));
        verify(appleClient, never()).getProviderId(anyString());              // 라우팅: kakao만 호출
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "kakao"));
    }

    @Test
    @DisplayName("기존 유저 소셜 로그인 → 매핑되어 isNewUser=false, 중복 생성 없음")
    void socialLoginExistingUser() {
        // given
        User existingUser = User.builder().id(USER_ID).build();
        SocialAccount existingAccount = SocialAccount.builder()
                .user(existingUser).provider(Provider.KAKAO).providerId("12345").build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(existingAccount));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        SocialLoginResponse response = authService.socialLogin(Provider.KAKAO, "kakao-token", null);

        // then
        assertThat(response.isNewUser()).isFalse();
        verify(userRepository, never()).save(any(User.class));
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("Apple 신규 로그인 → nickname(fullName) 세팅, method=apple 로깅")
    void socialLoginAppleSetsNickname() {
        // given
        User savedUser = User.builder().id(USER_ID).build();
        given(appleClient.getProviderId("apple-token")).willReturn("apple-sub");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.APPLE, "apple-sub"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        SocialLoginResponse response = authService.socialLogin(Provider.APPLE, "apple-token", "홍길동");

        // then
        assertThat(response.isNewUser()).isTrue();
        assertThat(savedUser.getNickname()).isEqualTo("홍길동");
        verify(kakaoClient, never()).getProviderId(anyString());              // 라우팅: apple만 호출
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "apple"));
    }

    @Test
    @DisplayName("등록되지 않은 provider → IllegalArgumentException")
    void socialLoginUnsupportedProvider() {
        // GOOGLE client는 주입되지 않았으므로 Map에 없다
        assertThatThrownBy(() -> authService.socialLogin(Provider.GOOGLE, "token", null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ── refreshToken ──────────────────────────────────────────────────────

    @Test
    @DisplayName("유효한 RT로 토큰 갱신 → 새 AT 반환")
    void refreshTokenSuccess() {
        // given
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findByRefreshToken("valid-rt")).willReturn(Optional.of(user));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("new-access-token");

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
