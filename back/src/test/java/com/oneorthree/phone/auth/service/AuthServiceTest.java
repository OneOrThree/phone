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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
                List.of(kakaoClient, appleClient), null);
        // 런타임엔 @Lazy 프록시가 주입되는 self — 단위 테스트에선 자기 자신으로 대체(재시도 경로가 실제 로직을 타도록)
        ReflectionTestUtils.setField(authService, "self", authService);
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
        // 기존 유저는 가입 이벤트 미발행
        verify(userActivityEventLogger, never())
                .log(anyString(), eq(UserActivityEvent.USER_SIGNED_UP), any());
    }

    @Test
    @DisplayName("신규 소셜 가입 → USER_SIGNED_UP + LOGIN_SUCCEEDED 둘 다 발행")
    void socialLoginNewUserEmitsSignedUp() {
        // given
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        authService.socialLogin(Provider.KAKAO, "kakao-token", null);

        // then: 가입 이벤트 + 로그인 이벤트 둘 다 발행
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "kakao", "is_guest", false));
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "kakao"));
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

    @Test
    @DisplayName("소프트딜리트된 소셜 계정으로 재로그인 → deletedAt null 복원(재활성화), isNewUser=false, 신규 row 없음")
    void socialLoginReactivatesDeletedAccount() {
        // given — deletedAt 이 세팅된(해제된) 계정
        User existingUser = User.builder().id(USER_ID).build();
        SocialAccount deletedAccount = SocialAccount.builder()
                .user(existingUser).provider(Provider.KAKAO).providerId("12345")
                .deletedAt(Instant.now()).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(deletedAccount));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        SocialLoginResponse response = authService.socialLogin(Provider.KAKAO, "kakao-token", null);

        // then — 재활성화: deletedAt 이 null, 신규 유저 아님, 신규 row 없음
        assertThat(response.isNewUser()).isFalse();
        assertThat(deletedAccount.getDeletedAt()).isNull();
        verify(userRepository, never()).save(any(User.class));
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
        // 재활성화 로그인은 isNewUser=false → 가입 이벤트 미발행 (527 정합)
        verify(userActivityEventLogger, never())
                .log(anyString(), eq(UserActivityEvent.USER_SIGNED_UP), any());
    }

    @Test
    @DisplayName("동시 첫 로그인 경쟁 → 유니크 위반 시 새 트랜잭션으로 재시도, 승자 계정으로 정상 로그인(isNewUser=false)")
    void socialLoginRetriesOnDuplicateRace() {
        // given — 1차 시도: 없음 → 생성 중 SocialAccount 저장이 유니크 위반, 2차 시도: 승자가 만든 계정 조회됨
        User existingUser = User.builder().id(USER_ID).build();
        SocialAccount winnerAccount = SocialAccount.builder()
                .user(existingUser).provider(Provider.KAKAO).providerId("12345").build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty(), Optional.of(winnerAccount));   // 1차 empty, 2차 present
        given(userRepository.save(any(User.class))).willReturn(User.builder().id(USER_ID).build());
        given(socialAccountRepository.save(any(SocialAccount.class)))
                .willThrow(new DataIntegrityViolationException("uq_social_accounts_provider_id"));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        SocialLoginResponse response = authService.socialLogin(Provider.KAKAO, "kakao-token", null);

        // then — 재시도로 기존(승자) 계정 반환, 500 없이 정상 로그인
        assertThat(response.isNewUser()).isFalse();
        assertThat(response.accessToken()).isEqualTo("access-token");
        // 조회 2회(1차 empty → 2차 present), providerId 추출은 재시도해도 1회(외부 호출 절약)
        verify(socialAccountRepository, times(2)).findByProviderAndProviderId(Provider.KAKAO, "12345");
        verify(kakaoClient).getProviderId("kakao-token");
        // 경쟁 패자는 신규 아님 → 가입 이벤트 미발행
        verify(userActivityEventLogger, never())
                .log(anyString(), eq(UserActivityEvent.USER_SIGNED_UP), any());
    }

    // ── guestLogin ────────────────────────────────────────────────────────

    @Test
    @DisplayName("게스트 로그인 → USER_SIGNED_UP(method=guest, is_guest=true) + LOGIN_SUCCEEDED 발행")
    void guestLoginEmitsSignedUp() {
        // given
        User savedUser = User.builder().id(USER_ID).isGuest(true).build();
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        authService.guestLogin();

        // then: 게스트 생성은 항상 신규 가입 → 가입·로그인 이벤트 둘 다 발행
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "guest", "is_guest", true));
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "guest"));
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
