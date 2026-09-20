package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.client.SocialLoginClient;
import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserQueryService userQueryService;
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
    /** 세션 축(GROMO-1659) — 이 클래스의 단언은 기존 RT 경로라, 세션 쓰기는 목으로 둔다. */
    @Mock
    private AuthSessionService authSessionService;
    /** 로그아웃의 기기 토큰 삭제 명령(A22 ㋗) — 같은 이유로 목이다. */
    @Mock
    private UserSatelliteCommandService userSatelliteCommandService;
    /** 2.0 게스트 기기 점유 원장(GROMO-2036) — 이 클래스가 검증하는 경로는 건드리지 않는다. */
    @Mock
    private com.oneorthree.phone.auth.repository.GuestDeviceClaimRepository guestDeviceClaimRepository;

    // provider별 검증 클라이언트 (모킹) — provider()로 Map이 구성된다
    @Mock
    private SocialLoginClient kakaoClient;
    @Mock
    private SocialLoginClient appleClient;

    private AuthService authService;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID GUEST_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    /** 세션 축 식별자 — AT 의 sid claim 이 되는 값(A22 ㋞). 값 자체엔 의미가 없다. */
    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");
    /** RT 만료 시각 — 회전 판정 스텁의 매칭 키. 값 자체엔 의미가 없고 같은 객체로 오가기만 하면 된다. */
    private static final Date RT_EXPIRES_AT = Date.from(Instant.parse("2026-09-01T00:00:00Z"));

    @BeforeEach
    void setUp() {
        given(kakaoClient.provider()).willReturn(Provider.KAKAO);
        given(appleClient.provider()).willReturn(Provider.APPLE);
        // 세션 축은 이 클래스의 검증 대상이 아니다 — 발급 경로가 sessionId 를 읽을 수 있게만 세운다.
        // lenient 인 이유: 로그인 실패를 단언하는 테스트들은 이 경로에 도달조차 하지 않는다.
        lenient().when(authSessionService.open(any(), anyString()))
                .thenReturn(new AuthSessionService.IssuedSession(SESSION_ID, 1L, "bootstrap"));
        lenient().when(authSessionService.rotateActive(any(), anyString(), anyString()))
                .thenReturn(Optional.of(new AuthSessionService.IssuedSession(SESSION_ID, 2L, null)));
        lenient().when(authSessionService.promoteLegacy(any(), anyString(), any()))
                .thenReturn(new AuthSessionService.IssuedSession(SESSION_ID, 2L, "promoted-bootstrap"));
        lenient().when(authSessionService.findByRefreshToken(anyString()))
                .thenReturn(java.util.Optional.empty());
        // 선택 AT 세션 관문(GROMO-1929) 통과 기본값 — AT 를 싣는 기존 테스트가 관문에 막히지 않게
        // 세대 일치(gen=0)·활성 세션을 기본으로 둔다. 관문 자체를 검증하는 테스트는 개별로 덮어쓴다.
        lenient().when(jwtProvider.extractSessionId(anyString())).thenReturn(SESSION_ID);
        lenient().when(jwtProvider.extractAuthGeneration(anyString())).thenReturn(0L);
        lenient().when(userQueryService.getCaller(any())).thenReturn(User.builder().build());
        lenient().when(authSessionService.verifySession(any(), any()))
                .thenReturn(Optional.of(AuthSession.builder().id(SESSION_ID).build()));
        authService = new AuthService(
                userRepository, userQueryService, userWalletRepository, userScreenTimeSettingsRepository,
                userFocusTimeSettingsRepository, userNotificationSettingsRepository,
                socialAccountRepository, jwtProvider, userActivityEventLogger,
                authSessionService, userSatelliteCommandService,
                // 기기 점유 원장·시계는 2.0 게스트 발급(GROMO-2036) 전용 축이라 이 클래스의 검증
                // 대상이 아니다 — 여기 테스트들은 기존 guestLogin·socialLogin·refreshToken 만 탄다.
                List.of(kakaoClient, appleClient), guestDeviceClaimRepository,
                java.time.Clock.systemUTC(), null);
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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

        // when
        SocialLoginResponse response = authService.socialLogin(Provider.KAKAO, "kakao-token", null);

        // then
        assertThat(response.isNewUser()).isTrue();
        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(response.refreshToken()).isEqualTo("refresh-token");
        // RT 는 평문이 아니라 SHA-256 해시로 저장돼야 한다 (GROMO-713)
        assertThat(savedUser.getRefreshTokenHash()).isEqualTo(TokenHasher.sha256Hex("refresh-token"));
        assertThat(savedUser.getRefreshTokenHash()).isNotEqualTo("refresh-token");
        verify(userRepository).save(any(User.class));
        verify(socialAccountRepository).save(any(SocialAccount.class));
        verify(appleClient, never()).getProviderId(anyString());              // 라우팅: kakao만 호출
        // 헤더 없음 = 유일한 익명 경로 — 선택 AT 관문을 타지 않는다 (GROMO-1929)
        verify(authSessionService, never()).verifySession(any(), any());
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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(existingUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

        // when
        authService.socialLogin(Provider.KAKAO, "kakao-token", null);

        // then: 가입 이벤트 + 로그인 이벤트 둘 다 발행
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "kakao", "is_guest", false));
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "kakao"));
    }

    @Test
    @DisplayName("Apple 신규 로그인 → nickname 은 세팅하지 않음(온보딩에서 입력), method=apple 로깅")
    void socialLoginAppleDoesNotSetNickname() {
        // given
        User savedUser = User.builder().id(USER_ID).build();
        given(appleClient.getProviderId("apple-token")).willReturn("apple-sub");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.APPLE, "apple-sub"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

        // when
        SocialLoginResponse response = authService.socialLogin(Provider.APPLE, "apple-token", null);

        // then — fullName 프리필 제거: 가입 시 nickname 은 null (users.nickname 유니크 제약과 동명이인 충돌 방지)
        assertThat(response.isNewUser()).isTrue();
        assertThat(savedUser.getNickname()).isNull();
        verify(kakaoClient, never()).getProviderId(anyString());              // 라우팅: apple만 호출
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "apple"));
    }

    @Test
    @DisplayName("등록되지 않은 provider → 400 UNSUPPORTED_PROVIDER (GROMO-1725, 종전 IllegalArgumentException 409)")
    void socialLoginUnsupportedProvider() {
        // GOOGLE client는 주입되지 않았으므로 Map에 없다
        assertThatThrownBy(() -> authService.socialLogin(Provider.GOOGLE, "token", null))
                .isInstanceOf(AuthException.class)
                .extracting("errorCode").isEqualTo(AuthErrorCode.UNSUPPORTED_PROVIDER);
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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(existingUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(existingUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

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

    @Test
    @DisplayName("로그인 도중 탈퇴가 먼저 커밋되면 — 배타 락 재검증이 삭제를 관측하고 NOT_FOUND, 토큰 미발급 (GROMO-801)")
    void socialLoginRejectsUserWithdrawnMidFlight() {
        // 소셜 계정 로드 시점엔 살아 있었지만, 토큰 발급 전에 탈퇴(배타 락)가 커밋된 레이스.
        // 재검증 없이 진행하면 refreshTokenHash 세팅의 full-row UPDATE 가 stale User 로
        // is_deleted=false·구 PII 를 되살리고, 발급된 토큰이 유효하게 남는다.
        User existingUser = User.builder().id(USER_ID).build();
        SocialAccount existingAccount = SocialAccount.builder()
                .user(existingUser).provider(Provider.KAKAO).providerId("12345").build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(existingAccount));
        // 배타 락 재검증이 탈퇴를 관측 — 활성 조회 빈 결과
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> authService.socialLogin(Provider.KAKAO, "kakao-token", null))
                .isInstanceOf(UserException.class)
                .hasFieldOrPropertyWithValue("errorCode", UserErrorCode.USER_NOT_FOUND);
        // 토큰 상태 변경 없음 — 발급 자체가 시작되지 않는다
        assertThat(existingUser.getRefreshTokenHash()).isNull();
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
        verify(jwtProvider, never()).generateRefreshToken(any(UUID.class), anyBoolean());
    }

    // ── 게스트→소셜 업그레이드 (GROMO-585) ──────────────────────────────────

    @Test
    @DisplayName("게스트 + 신규 소셜 → 기존 게스트 User 재활용(isGuest=false), SocialAccount 생성, "
            + "createUserSideRows 미호출, isNewUser=false")
    void guestUpgradeWithNewSocial() {
        // given — 게스트 JWT 헤더로 요청, 해당 소셜 계정은 아직 없음
        User guestUser = User.builder().id(GUEST_ID).isGuest(true).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        // 게스트 로드가 곧 배타 락 조회다 (GROMO-801 codex 2·4차) — setGuest(false) 등 변경보다 락이
        // 먼저여야 하고, 잠그는 대상은 활성 게스트 행뿐이다(isGuest 술어 — 계정 전환 2행 잠금 교착 방지).
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.of(guestUser));
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userQueryService.getCallerForUpdate(GUEST_ID)).willReturn(guestUser);
        // 승격 직후 발급 — isGuest=false 상태의 토큰이 나간다 (GROMO-1229)
        given(jwtProvider.generateAccessToken(eq(GUEST_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(GUEST_ID, false)).willReturn("refresh-token");

        // when
        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt");

        // then — 기존 게스트 User 재활용: 신규 아님, isGuest 해제, 새 User 저장 없음
        assertThat(response.isNewUser()).isFalse();
        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(guestUser.isGuest()).isFalse();
        assertThat(guestUser.getRefreshTokenHash()).isEqualTo(TokenHasher.sha256Hex("refresh-token"));
        verify(userRepository, never()).save(any(User.class));            // 새 User 생성 금지(재활용)
        verify(socialAccountRepository).save(any(SocialAccount.class));    // 소셜 연동만 새로 부착
        // 선택 AT 관문이 실제로 탔다 — sid·세대 일치·활성 세션이라 통과 (GROMO-1929)
        verify(authSessionService).verifySession(GUEST_ID, SESSION_ID);
        // createUserSideRows 미호출 — 부속 row 는 게스트 생성 시 이미 존재(중복 방지)
        verify(userWalletRepository, never()).save(any());
        verify(userScreenTimeSettingsRepository, never()).save(any());
        verify(userFocusTimeSettingsRepository, never()).save(any());
        verify(userNotificationSettingsRepository, never()).save(any());
        // 업그레이드는 신규 가입이 아님 → 가입 이벤트 미발행
        verify(userActivityEventLogger, never())
                .log(anyString(), eq(UserActivityEvent.USER_SIGNED_UP), any());
    }

    @Test
    @DisplayName("게스트 + 이미 연동된 소셜 → SOCIAL_ACCOUNT_ALREADY_LINKED, 게스트 유지·연동 없음")
    void guestUpgradeWithAlreadyLinkedSocialRejected() {
        // given — 게스트 JWT 헤더, 그러나 해당 소셜 계정은 이미 다른 User 에 연동됨
        User guestUser = User.builder().id(GUEST_ID).isGuest(true).build();
        User otherUser = User.builder().id(USER_ID).build();
        SocialAccount linkedAccount = SocialAccount.builder()
                .user(otherUser).provider(Provider.KAKAO).providerId("12345").build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(linkedAccount));
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.of(guestUser));

        // when & then — 업그레이드 거부, 게스트 상태 유지, 연동/저장 없음
        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SOCIAL_ACCOUNT_ALREADY_LINKED);
        assertThat(guestUser.isGuest()).isTrue();
        verify(userRepository, never()).save(any(User.class));
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("게스트 승격 락은 변경보다 먼저다 — 승격 분기에서 락 조회 후에야 연동 저장이 실행된다 (GROMO-801 codex 2차·claude 권고)")
    void guestUpgradeLockPrecedesMutation() {
        // 락이 뒤(토큰 발급 전 재검증)에만 있으면 setGuest(false)·소셜 연동 저장이 먼저 실행되고,
        // 재검증 쿼리 직전 auto-flush 가 그 언버전 UPDATE 를 락 획득 전에 내보내 탈퇴를 덮어쓴다.
        // 실제 게스트로 승격 분기를 태워, 락 조회가 mutation(연동 저장)보다 앞임을 순서로 고정한다
        // (빈 결과 스텁이면 신규 가입 분기로 빠져 이 순서를 아무것도 증명하지 못한다 — claude 권고).
        User guestUser = User.builder().id(GUEST_ID).isGuest(true).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.of(guestUser));
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userQueryService.getCallerForUpdate(GUEST_ID)).willReturn(guestUser);
        // 승격 직후 발급 — isGuest=false 상태의 토큰이 나간다 (GROMO-1229)
        given(jwtProvider.generateAccessToken(eq(GUEST_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(GUEST_ID, false)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt");

        // 승격 분기를 실제로 탔다 — 재활용(신규 아님)·isGuest 해제·새 User 저장 없음
        assertThat(response.isNewUser()).isFalse();
        assertThat(guestUser.isGuest()).isFalse();
        verify(userRepository, never()).save(any(User.class));
        // 락 조회(게스트 한정 배타 락)가 mutation(소셜 연동 저장)보다 앞이다
        InOrder lockFirst = inOrder(userRepository, socialAccountRepository);
        lockFirst.verify(userRepository).findActiveGuestByIdForUpdate(GUEST_ID);
        lockFirst.verify(socialAccountRepository).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("refresh 토큰을 선택 AT 로 보내면 401 ACCESS_TOKEN — 타입 가드가 익명 강등하지 않는다 (GROMO-714 · 1929)")
    void refreshTokenAsCallerIsRejected() {
        // /auth/* 는 JwtFilter 화이트리스트라 필터 타입 가드를 타지 않는다.
        // 서명이 유효한 refresh 토큰을 Authorization 헤더로 보내 게스트를 승격시키려는 시도.
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("stolen-rt")).willReturn(true);
        given(jwtProvider.extractType("stolen-rt")).willReturn(JwtProvider.TYPE_REFRESH);

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer stolen-rt"))
                .isInstanceOf(InvalidTokenException.class)
                .hasFieldOrPropertyWithValue("errorCode", InvalidTokenErrorCode.ACCESS_TOKEN);
        // 타입 가드에서 걸려 userId 추출도, 신규 가입 폴백도 일어나지 않는다
        verify(jwtProvider, never()).extractUserId("stolen-rt");
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("type 클레임 없는 구 토큰은 401 ACCESS_TOKEN — fail-closed (GROMO-1929)")
    void legacyTokenWithoutTypeIsRejected() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("legacy-jwt")).willReturn(true);
        given(jwtProvider.extractType("legacy-jwt")).willReturn(null);

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer legacy-jwt"))
                .isInstanceOf(InvalidTokenException.class)
                .hasFieldOrPropertyWithValue("errorCode", InvalidTokenErrorCode.ACCESS_TOKEN);
        verify(jwtProvider, never()).extractUserId("legacy-jwt");
        verify(userRepository, never()).save(any(User.class));
    }

    // ── 선택 AT 세션 폐기 관문 (GROMO-1929) ─────────────────────────────────

    @Test
    @DisplayName("Bearer 아닌 Authorization 헤더 → 401 ACCESS_TOKEN — 헤더 없음만 익명이다")
    void malformedAuthorizationHeaderIsRejected() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Basic abc"))
                .isInstanceOf(InvalidTokenException.class)
                .hasFieldOrPropertyWithValue("errorCode", InvalidTokenErrorCode.ACCESS_TOKEN);
        verify(jwtProvider, never()).isTokenValid(anyString());
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("만료·위조 AT → 401 ACCESS_TOKEN + 신규 계정 미생성 — 익명 강등 폐지 (GROMO-1929)")
    void invalidCallerTokenIsRejected() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("expired-jwt")).willReturn(false);

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer expired-jwt"))
                .isInstanceOf(InvalidTokenException.class)
                .hasFieldOrPropertyWithValue("errorCode", InvalidTokenErrorCode.ACCESS_TOKEN);
        // 신규 가입 분기로 떨어지지 않는다 — 유령 계정·토큰 발급 없음
        verify(userRepository, never()).save(any(User.class));
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    /**
     * 관문 거절 테스트 공통 스텁 — 관문 ②(신규 폴백)는 호출자 users 락으로 연다 (GROMO-1929).
     * 활성 호출자(gen=0, lenient 기본값과 일치)를 돌려줘 관문 판정부까지 도달하게 만든다.
     */
    private void stubCallerLock() {
        given(userQueryService.getCallerForUpdate(GUEST_ID))
                .willReturn(User.builder().id(GUEST_ID).build());
    }

    @Test
    @DisplayName("폐기된 세션의 AT → 401 LEGACY_SESSION_NOT_ACTIVE — 서명이 멀쩡해도 승격 자격이 아니다")
    void revokedSessionCallerIsRejected() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        stubCallerLock();
        given(authSessionService.verifySession(GUEST_ID, SESSION_ID))
                .willReturn(Optional.of(AuthSession.builder().id(SESSION_ID).userId(GUEST_ID)
                        .revokedAt(Instant.now()).build()));

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LEGACY_SESSION_NOT_ACTIVE);
        // 관문은 save·발급보다 먼저다 — 거절 경로에 어떤 쓰기도 없다
        verify(userRepository, never()).save(any(User.class));
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
        verify(jwtProvider, never()).generateRefreshToken(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("세션 행이 없거나 남의 것이면 401 LEGACY_SESSION_NOT_ACTIVE — verifySession 이 비어 온다")
    void missingSessionCallerIsRejected() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        stubCallerLock();
        given(authSessionService.verifySession(GUEST_ID, SESSION_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LEGACY_SESSION_NOT_ACTIVE);
        verify(userRepository, never()).save(any(User.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("authGeneration 불일치는 401 LEGACY_SESSION_NOT_ACTIVE — 세션 조회 전에 끊는다")
    void generationMismatchCallerIsRejected() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(jwtProvider.extractAuthGeneration("guest-jwt")).willReturn(9L);   // DB 세대는 0
        stubCallerLock();

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LEGACY_SESSION_NOT_ACTIVE);
        verify(authSessionService, never()).verifySession(any(), any());
        verify(userRepository, never()).save(any(User.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("sid 없는 구 AT 는 401 LEGACY_SESSION_NOT_ACTIVE — 어느 세션인지 증명할 수 없어 폐기 fence 를 못 건다")
    void sidlessCallerTokenIsRejected() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("old-jwt")).willReturn(true);
        given(jwtProvider.extractType("old-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("old-jwt")).willReturn(GUEST_ID);
        given(jwtProvider.extractSessionId("old-jwt")).willReturn(null);
        stubCallerLock();

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer old-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LEGACY_SESSION_NOT_ACTIVE);
        verify(authSessionService, never()).verifySession(any(), any());
        verify(userRepository, never()).save(any(User.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("탈퇴·부재 주체의 AT 는 관문에서 USER_NOT_FOUND — 폐기 판정보다 계정 부재가 «먼저» (GROMO-1929 · LLD §1)")
    void withdrawnCallerIsRejectedAtGate() {
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("deleted-guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("deleted-guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("deleted-guest-jwt")).willReturn(GUEST_ID);
        // 관문 ② 의 호출자 락이 탈퇴를 관측해 404 — 폐기 판정·신규 가입 폴백까지 내려가지 않는다
        given(userQueryService.getCallerForUpdate(GUEST_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer deleted-guest-jwt"))
                .isInstanceOf(UserException.class)
                .hasFieldOrPropertyWithValue("errorCode", UserErrorCode.USER_NOT_FOUND);
        verify(authSessionService, never()).verifySession(any(), any());
        verify(userRepository, never()).save(any(User.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("폐기 세션의 게스트 + 이미 연동된 소셜 → 409 가 아니라 401 — 세션 관문이 도메인 분기보다 먼저다 (GROMO-1929)")
    void revokedSessionGuestWithLinkedSocialGets401Not409() {
        // 게스트가 이미 다른 계정에 연동된 소셜로 승격 시도 — 세션이 살아 있으면 409(ALREADY_LINKED)
        // 지만, 폐기 세션이면 세션 관문이 먼저 401 로 끊어야 한다 (승인 정책: 거절 우선순위).
        User guestUser = User.builder().id(GUEST_ID).isGuest(true).build();
        User otherUser = User.builder().id(USER_ID).build();
        SocialAccount linkedAccount = SocialAccount.builder()
                .user(otherUser).provider(Provider.KAKAO).providerId("12345").build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(linkedAccount));
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.of(guestUser));
        given(authSessionService.verifySession(GUEST_ID, SESSION_ID))
                .willReturn(Optional.of(AuthSession.builder().id(SESSION_ID).userId(GUEST_ID)
                        .revokedAt(Instant.now()).build()));

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LEGACY_SESSION_NOT_ACTIVE);
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("세션 관문은 발급 트랜잭션 안에서 연다 — users 락 뒤·mutation·토큰 발급 전 순서 고정, TX 밖 선검사의 TOCTOU 제거 (GROMO-1929 codex P1)")
    void sessionCheckRunsInsideIssuanceTransaction() {
        // 별도 TX 의 사전 관문은 검사·발급 사이에 로그아웃이 끼는 TOCTOU 를 남겼다 — 관문이
        // loginOrRegister(발급 TX) 안에서 users 락 뒤·mutation·발급 전에 타는지 호출 순서로 고정한다.
        User guestUser = User.builder().id(GUEST_ID).isGuest(true).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.of(guestUser));
        given(userQueryService.getCallerForUpdate(GUEST_ID)).willReturn(guestUser);
        given(jwtProvider.generateAccessToken(eq(GUEST_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(GUEST_ID, false)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt");

        assertThat(response.isNewUser()).isFalse();
        // 락·판정 순서: users(게스트 승격 락) → auth_sessions(verifySession 배타 락, 관문 ①)
        // → 소셜 연동 저장(mutation) → users(탈퇴 직렬화 락) → 토큰 발급 — 관문이 발급과 같은
        // TX 안에서 mutation 보다 먼저 탐을 순서로 고정한다
        InOrder order = inOrder(userRepository, socialAccountRepository, userQueryService,
                authSessionService, jwtProvider);
        order.verify(userRepository).findActiveGuestByIdForUpdate(GUEST_ID);
        order.verify(authSessionService).verifySession(GUEST_ID, SESSION_ID);
        order.verify(socialAccountRepository).save(any(SocialAccount.class));
        order.verify(userQueryService).getCallerForUpdate(GUEST_ID);
        order.verify(jwtProvider).generateAccessToken(eq(GUEST_ID), eq(false), anyLong(), any());
    }

    // ── 동시 다른-소셜 승격 경쟁 판별 (GROMO-1229) ───────────────────────────

    @Test
    @DisplayName("게스트 AT(guest 클레임 true)인데 이미 비게스트로 승격돼 있으면 → GUEST_ALREADY_PROMOTED, "
            + "유령 계정 생성 없음 (GROMO-1229)")
    void concurrentPromotionLoserGetsConflict() {
        // 같은 게스트 AT 로 두 기기가 서로 다른 소셜에 동시 로그인한 경쟁의 패자 시나리오 —
        // 승자가 승격을 커밋한 뒤라 게스트 락 조회는 술어 재평가에서 비고(is_guest=false),
        // 그 유저는 활성 비게스트로 존재한다. 신규 가입 폴백 대신 409 로 끊어야 한다.
        User promotedUser = User.builder().id(GUEST_ID).isGuest(false).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(jwtProvider.extractIsGuest("guest-jwt")).willReturn(true);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        // 관문 ② 의 호출자 락 — 승격된 본인 행이 살아 있어 관문은 통과한다 (GROMO-1929)
        given(userQueryService.getCallerForUpdate(GUEST_ID)).willReturn(promotedUser);
        // 판별 조회는 무락 findByIdAndIsDeletedFalse — 락을 잡으면 users 2행 잠금이 되어 교착 논증이 깨진다
        given(userQueryService.findActive(GUEST_ID)).willReturn(Optional.of(promotedUser));

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.GUEST_ALREADY_PROMOTED);
        // 유령 계정 차단 — 신규 User·소셜 연동 어느 쪽도 저장되지 않고 토큰도 발급되지 않는다
        verify(userRepository, never()).save(any(User.class));
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("같은 소셜 동시 승격의 패자는 에러가 아니라 승자(=본인) 계정으로 정상 로그인한다 (GROMO-1229 codex R1)")
    void concurrentPromotionSameSocialLoserLogsIntoPromotedAccount() {
        // 두 기기가 같은 게스트 AT 로 **같은** (provider, providerId)에 동시 로그인한 패자 —
        // 첫 조회는 승자 커밋 전이라 empty, 게스트 락 대기를 지나온 뒤의 재조회는 승자가 붙인
        // 계정을 본다. 종전엔 유니크 위반 → DIVE 재시도가 만들던 자가치유 결말과 같아야 한다.
        // 409 로 끊으면 같은 기기 더블탭까지 에러가 되는 회귀다(codex R1).
        User promotedUser = User.builder().id(GUEST_ID).isGuest(false).build();
        SocialAccount winnerAccount = SocialAccount.builder()
                .user(promotedUser).provider(Provider.KAKAO).providerId("12345").build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty(), Optional.of(winnerAccount)); // 1차 empty → 판별 재조회 present
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(jwtProvider.extractIsGuest("guest-jwt")).willReturn(true);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        given(userQueryService.findActive(GUEST_ID)).willReturn(Optional.of(promotedUser));
        given(userQueryService.getCallerForUpdate(GUEST_ID)).willReturn(promotedUser);
        given(jwtProvider.generateAccessToken(eq(GUEST_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(GUEST_ID, false)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt");

        // 승자 계정(= 방금 승격된 본인)으로 정상 로그인 — 신규 아님, 유령 계정 없음
        assertThat(response.isNewUser()).isFalse();
        assertThat(response.accessToken()).isEqualTo("access-token");
        verify(userRepository, never()).save(any(User.class));
        verify(socialAccountRepository, never()).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("판별 재조회가 찾은 소셜 계정이 다른 유저 소유면 자가치유가 아니다 → GUEST_ALREADY_PROMOTED (GROMO-1229 codex R2)")
    void concurrentPromotionRequeryRejectsForeignAccount() {
        // 다른-소셜 경쟁의 패자 + 제3의 요청이 같은 (provider, providerId)를 **다른 계정**에 선점한
        // 조합 — 재조회 결과로 그냥 로그인하면 게스트 데이터가 어디로 승격됐는지 숨긴 채 다른
        // 계정에 앉히는 조용한 계정 이동이 된다. 소유자(= 승격된 본인)일 때만 자가치유한다.
        User promotedUser = User.builder().id(GUEST_ID).isGuest(false).build();
        User foreignUser = User.builder().id(USER_ID).isGuest(false).build();
        SocialAccount foreignAccount = SocialAccount.builder()
                .user(foreignUser).provider(Provider.KAKAO).providerId("12345").build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty(), Optional.of(foreignAccount)); // 1차 empty → 재조회는 타인 계정
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(jwtProvider.extractIsGuest("guest-jwt")).willReturn(true);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        given(userQueryService.getCallerForUpdate(GUEST_ID)).willReturn(promotedUser);
        given(userQueryService.findActive(GUEST_ID)).willReturn(Optional.of(promotedUser));

        assertThatThrownBy(() ->
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt"))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.GUEST_ALREADY_PROMOTED);
        verify(userRepository, never()).save(any(User.class));
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("승격된 게스트 클레임 AT 로 선재 타 계정 소셜에 로그인 — 정상 통과, 가드를 걸지 않는다 (GROMO-1229 D17·D18)")
    void presentBranchAllowsPreExistingAccountAfterPromotion() {
        // 리뷰 5라운드 결론의 회귀 락 — 이 상태는 '정당한 선재 계정 재로그인'과 '레이스 패자'가
        // 서버 관점에서 구분 불가능하고(시간 신호 시도는 대상 계정 createdAt 이 레이스와 무인과라
        // 실패), 통과 결말은 소셜 토큰 검증으로 소유가 증명된 계정 로그인이라 유령이 아니다.
        // present 분기에 승격 패자 가드를 되살리면 이 테스트가 깨진다 — 되살리려면 D17·D18 재론부터.
        User accountOwner = User.builder().id(USER_ID).isGuest(false).build();
        SocialAccount preExisting = SocialAccount.builder()
                .user(accountOwner).provider(Provider.KAKAO).providerId("12345")
                .build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.of(preExisting));
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(jwtProvider.extractIsGuest("guest-jwt")).willReturn(true);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(accountOwner);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt");

        assertThat(response.isNewUser()).isFalse();
        assertThat(response.accessToken()).isEqualTo("access-token");
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("guest 클레임 없는 구 토큰은 비게스트로 간주 → 판별 조회 없이 현행 신규 가입 폴백 유지 (GROMO-1229 점진 적용)")
    void legacyTokenWithoutGuestClaimKeepsFallback() {
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("legacy-access-jwt")).willReturn(true);
        given(jwtProvider.extractType("legacy-access-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("legacy-access-jwt")).willReturn(GUEST_ID);
        // guest 클레임이 없는 구 토큰 — extractIsGuest 는 null 을 반환한다
        given(jwtProvider.extractIsGuest("legacy-access-jwt")).willReturn(null);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        // 관문 ② 의 호출자 락 — 활성 호출자(gen=0)라 통과 (GROMO-1929)
        given(userQueryService.getCallerForUpdate(GUEST_ID))
                .willReturn(User.builder().id(GUEST_ID).build());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer legacy-access-jwt");

        // 구 토큰 = 비게스트 간주(현행 동작 유지) — 판별 조회 자체를 하지 않는다
        assertThat(response.isNewUser()).isTrue();
        verify(userRepository, never()).findByIdAndIsDeletedFalse(any(UUID.class));
    }

    @Test
    @DisplayName("비게스트 AT(guest 클레임 false)의 정식 계정 전환은 판별에 걸리지 않는다 — 신규 가입 유지 (GROMO-1229)")
    void nonGuestAccountSwitchIsNotBlocked() {
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("social-jwt")).willReturn(true);
        given(jwtProvider.extractType("social-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("social-jwt")).willReturn(GUEST_ID);
        // 소셜 로그인으로 발급된 AT — guest=false 클레임
        given(jwtProvider.extractIsGuest("social-jwt")).willReturn(false);
        given(userRepository.findActiveGuestByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        // 관문 ② 의 호출자 락 — 활성 호출자라 통과 (GROMO-1929)
        given(userQueryService.getCallerForUpdate(GUEST_ID))
                .willReturn(User.builder().id(GUEST_ID).build());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(savedUser);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer social-jwt");

        // 정식 계정 전환(비게스트 AT 로 새 소셜 로그인)은 기존 동작 그대로 새 User 생성
        assertThat(response.isNewUser()).isTrue();
        verify(userRepository, never()).findByIdAndIsDeletedFalse(any(UUID.class));
    }

    // ── guestLogin ────────────────────────────────────────────────────────

    @Test
    @DisplayName("게스트 로그인 → USER_SIGNED_UP(method=guest, is_guest=true) + LOGIN_SUCCEEDED 발행")
    void guestLoginEmitsSignedUp() {
        // given
        User savedUser = User.builder().id(USER_ID).isGuest(true).build();
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        // 게스트 발급 경로는 guest=true 클레임을 싣는다 (GROMO-1229)
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(true), anyLong(), any())).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID, true)).willReturn("refresh-token");

        // when
        authService.guestLogin();

        // then: 게스트 생성은 항상 신규 가입 → 가입·로그인 이벤트 둘 다 발행
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "guest", "is_guest", true));
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "guest"));
    }

    // ── refreshToken ──────────────────────────────────────────────────────

    /** 회전 판정에 걸리지 않는(수명 넉넉한) 활성 세션 한 건. */
    private AuthSession activeSession(UUID sessionId, UUID ownerId) {
        return AuthSession.builder().id(sessionId).userId(ownerId)
                .refreshTokenHash("irrelevant").sessionEpoch(1L).build();
    }

    @Test
    @DisplayName("유효한 RT로 토큰 갱신 → 새 AT 반환, 수명 넉넉하면 RT 는 회전하지 않는다 (GROMO-1509)")
    void refreshTokenSuccess() {
        // given
        User user = User.builder().id(USER_ID).refreshTokenHash(TokenHasher.sha256Hex("valid-rt")).build();
        given(jwtProvider.extractType("valid-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("valid-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("valid-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("new-access-token");
        given(jwtProvider.isRefreshRotationDue(RT_EXPIRES_AT, false)).willReturn(false);
        given(authSessionService.findByRefreshToken("valid-rt"))
                .willReturn(Optional.of(activeSession(SESSION_ID, USER_ID)));

        // when
        TokenRefreshResponse response = authService.refreshToken("valid-rt");

        // then: 회전이 없으면 RT 는 null 로 내려가고 저장된 해시도 그대로다(클라가 저장소를 안 건드림)
        assertThat(response.accessToken()).isEqualTo("new-access-token");
        assertThat(response.refreshToken()).isNull();
        // sid 는 «지금 쥔 RT 의 세션» 이어야 한다 — 여기가 어긋나면 위성의 세션 확인이 남의 세션을 본다
        assertThat(response.sessionId()).isEqualTo(SESSION_ID);
        assertThat(user.getRefreshTokenHash()).isEqualTo(TokenHasher.sha256Hex("valid-rt"));
        verify(jwtProvider, never()).generateRefreshToken(any(), anyBoolean());
    }

    @Test
    @DisplayName("세션 조회보다 users 배타 락이 «먼저» 온다 — 로그아웃이 방금 끊은 세션으로 AT 를 내주지 않는다 "
            + "(codex R10 락 순서)")
    void refreshTokenLocksUserBeforeReadingSession() {
        // given
        User user = User.builder().id(USER_ID).refreshTokenHash(TokenHasher.sha256Hex("valid-rt")).build();
        given(jwtProvider.extractType("valid-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("valid-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("valid-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(jwtProvider.isRefreshRotationDue(RT_EXPIRES_AT, false)).willReturn(false);
        given(authSessionService.findByRefreshToken("valid-rt"))
                .willReturn(Optional.of(activeSession(SESSION_ID, USER_ID)));

        // when
        authService.refreshToken("valid-rt");

        // then: 순서가 뒤집히면 users 락이 「세션을 읽은 뒤」에 걸려, 그 사이 커밋된 로그아웃을 못 본다.
        InOrder order = inOrder(userRepository, authSessionService);
        order.verify(userRepository).findActiveByIdForUpdate(USER_ID);
        order.verify(authSessionService).findByRefreshToken("valid-rt");
    }

    @Test
    @DisplayName("남은 수명이 절반 미만이면 RT 회전 — 세션 CAS 로 갈아끼우고 유저 단일 해시도 함께 전진 (GROMO-1509)")
    void refreshTokenRotatesWhenDue() {
        // given: 이 기기가 마지막 로그인 = 유저 단일 해시가 아직 이 RT 를 가리킨다
        User user = User.builder().id(USER_ID).refreshTokenHash(TokenHasher.sha256Hex("old-rt")).build();
        AuthSession session = activeSession(SESSION_ID, USER_ID);
        given(jwtProvider.extractType("old-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("old-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("old-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(authSessionService.findByRefreshToken("old-rt")).willReturn(Optional.of(session));
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("new-access-token");
        given(jwtProvider.isRefreshRotationDue(RT_EXPIRES_AT, false)).willReturn(true);
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("rotated-rt");
        given(userRepository.rotateRefreshTokenHash(USER_ID, TokenHasher.sha256Hex("old-rt"),
                TokenHasher.sha256Hex("rotated-rt"))).willReturn(1);

        // when
        TokenRefreshResponse response = authService.refreshToken("old-rt");

        // then: 회전의 권위는 «세션 행»이고, 유저 단일 해시는 그 옆에서 따라 움직인다.
        // 유저 해시를 안 옮기면 회전으로 죽은 옛 RT 가 유저 행에 남아 구 RT 승격 경로로 되살아난다.
        assertThat(response.refreshToken()).isEqualTo("rotated-rt");
        assertThat(response.sessionId()).isEqualTo(SESSION_ID);
        verify(authSessionService).rotateActive(session, "old-rt", "rotated-rt");
        // 해시 교체는 엔티티 dirty checking 이 아니라 조건부 UPDATE 로 나가야 한다 —
        // 엔티티에 쓰면 full-row UPDATE 가 탈퇴가 세운 is_deleted·파기된 PII 를 되살린다(코드리뷰 P1).
        verify(userRepository).rotateRefreshTokenHash(USER_ID, TokenHasher.sha256Hex("old-rt"),
                TokenHasher.sha256Hex("rotated-rt"));
        assertThat(user.getRefreshTokenHash()).isEqualTo(TokenHasher.sha256Hex("old-rt"));
    }

    @Test
    @DisplayName("B 기기가 뒤에 로그인해 유저 단일 해시를 가져가도 A 기기의 갱신은 산다 — 세션 원장이 먼저다 "
            + "(codex R10 P1)")
    void refreshTokenOnSessionSurvivesOtherDeviceLogin() {
        // given: users.refresh_token_hash 는 B 의 것. 종전 코드는 여기서 A 를 401 로 떨어뜨렸다.
        User user = User.builder().id(USER_ID)
                .refreshTokenHash(TokenHasher.sha256Hex("device-b-rt")).build();
        AuthSession sessionA = activeSession(SESSION_ID, USER_ID);
        given(jwtProvider.extractType("device-a-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("device-a-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("device-a-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(authSessionService.findByRefreshToken("device-a-rt")).willReturn(Optional.of(sessionA));
        given(jwtProvider.isRefreshRotationDue(RT_EXPIRES_AT, false)).willReturn(true);
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("device-a-rotated");
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("device-a-at");

        // when
        TokenRefreshResponse response = authService.refreshToken("device-a-rt");

        // then: A 는 정상 회전하고
        assertThat(response.accessToken()).isEqualTo("device-a-at");
        assertThat(response.refreshToken()).isEqualTo("device-a-rotated");
        assertThat(response.sessionId()).isEqualTo(SESSION_ID);
        verify(authSessionService).rotateActive(sessionA, "device-a-rt", "device-a-rotated");
        // B 가 가진 유저 단일 해시는 «건드리지 않는다» — 덮으면 이번엔 B 의 구 RT 경로가 끊긴다.
        verify(userRepository, never()).rotateRefreshTokenHash(any(), anyString(), anyString());
        assertThat(user.getRefreshTokenHash()).isEqualTo(TokenHasher.sha256Hex("device-b-rt"));
    }

    @Test
    @DisplayName("폐기된 세션의 RT 는 유저 단일 해시가 무엇이든 401 — 끊긴 세션은 되살리지 않는다 (A22 ㋞)")
    void refreshTokenRejectsRevokedSession() {
        // given: 이 기기가 마지막 로그인이라 유저 해시는 아직 이 RT 를 가리키지만, 세션은 끊겼다.
        User user = User.builder().id(USER_ID).refreshTokenHash(TokenHasher.sha256Hex("revoked-rt")).build();
        AuthSession revoked = activeSession(SESSION_ID, USER_ID);
        revoked.revoke(Instant.parse("2026-09-01T00:00:00Z"), "LOGOUT");
        given(jwtProvider.extractType("revoked-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("revoked-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("revoked-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(authSessionService.findByRefreshToken("revoked-rt")).willReturn(Optional.of(revoked));

        // when & then: 구 RT 승격 경로로 흘러 되살아나서는 안 된다
        assertThatThrownBy(() -> authService.refreshToken("revoked-rt"))
                .isInstanceOf(InvalidTokenException.class);
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
        verify(authSessionService, never()).promoteLegacy(any(), anyString(), any());
    }

    @Test
    @DisplayName("남의 세션 행을 가리키는 RT → 401 (서명된 소유자와 대조)")
    void refreshTokenRejectsSessionOwnedByAnotherUser() {
        // given
        User user = User.builder().id(USER_ID).build();
        given(jwtProvider.extractType("stolen-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("stolen-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("stolen-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(authSessionService.findByRefreshToken("stolen-rt"))
                .willReturn(Optional.of(activeSession(SESSION_ID, GUEST_ID)));

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("stolen-rt"))
                .isInstanceOf(InvalidTokenException.class);
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("회전 직전 세션 CAS 가 0행 → 401, 끊긴 세션을 되살리지 않는다 (GROMO-1509 · 1659)")
    void refreshTokenRejectsWhenRotationLosesRace() {
        // given: 락 아래 조회는 통과했지만 세션 CAS 시점엔 이미 폐기·회전 조건이 깨졌다(fail-closed 경로)
        User user = User.builder().id(USER_ID).refreshTokenHash(TokenHasher.sha256Hex("old-rt")).build();
        AuthSession session = activeSession(SESSION_ID, USER_ID);
        given(jwtProvider.extractType("old-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("old-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("old-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(authSessionService.findByRefreshToken("old-rt")).willReturn(Optional.of(session));
        given(jwtProvider.isRefreshRotationDue(RT_EXPIRES_AT, false)).willReturn(true);
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("rotated-rt");
        given(userRepository.rotateRefreshTokenHash(USER_ID, TokenHasher.sha256Hex("old-rt"),
                TokenHasher.sha256Hex("rotated-rt"))).willReturn(1);
        given(authSessionService.rotateActive(session, "old-rt", "rotated-rt")).willReturn(Optional.empty());

        // when & then: 401 이고, AT 는 «아예 만들어지지도 않는다».
        // 종전에는 CAS 보다 «먼저» AT 를 만들어 두고 버렸는데, GROMO-1659 에서 AT 에 세션 식별자
        // (sid)가 실리면서 발급 시점이 CAS 뒤로 옮겨졌다 — 회전 결과를 모르는 채로는 어느 세션의
        // 토큰인지 정할 수 없기 때문이다. 겉으로 보이는 계약(401·토큰 없음)은 그대로다.
        assertThatThrownBy(() -> authService.refreshToken("old-rt"))
                .isInstanceOf(InvalidTokenException.class);
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class), anyBoolean(), anyLong(), any());
    }

    @Test
    @DisplayName("게스트 회전은 게스트 수명으로 발급된다 — 판정·발급 모두 isGuest=true (GROMO-1509)")
    void refreshTokenRotatesGuestWithGuestLifetime() {
        // given
        User guest = User.builder().id(USER_ID).isGuest(true)
                .refreshTokenHash(TokenHasher.sha256Hex("guest-rt")).build();
        AuthSession session = activeSession(SESSION_ID, USER_ID);
        given(jwtProvider.extractType("guest-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("guest-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("guest-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(guest));
        given(authSessionService.findByRefreshToken("guest-rt")).willReturn(Optional.of(session));
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(true), anyLong(), any())).willReturn("guest-at");
        given(jwtProvider.isRefreshRotationDue(RT_EXPIRES_AT, true)).willReturn(true);
        given(jwtProvider.generateRefreshToken(USER_ID, true)).willReturn("guest-rotated-rt");
        given(userRepository.rotateRefreshTokenHash(USER_ID, TokenHasher.sha256Hex("guest-rt"),
                TokenHasher.sha256Hex("guest-rotated-rt"))).willReturn(1);

        // when
        TokenRefreshResponse response = authService.refreshToken("guest-rt");

        // then
        assertThat(response.refreshToken()).isEqualTo("guest-rotated-rt");
        verify(jwtProvider).generateRefreshToken(USER_ID, true);
    }

    @Test
    @DisplayName("세션 행 없는 구 RT → 수명과 무관하게 회전하며 세션 축으로 승격된다 (A22 ㋪)")
    void refreshTokenPromotesLegacyRefreshToken() {
        // given: 세션 행이 없다. 유저 단일 해시가 유일한 판정 근거다.
        User user = User.builder().id(USER_ID).refreshTokenHash(TokenHasher.sha256Hex("legacy-rt")).build();
        given(jwtProvider.extractType("legacy-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("legacy-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("legacy-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(authSessionService.findByRefreshToken("legacy-rt")).willReturn(Optional.empty());
        given(jwtProvider.generateRefreshToken(USER_ID, false)).willReturn("promoted-rt");
        given(userRepository.rotateRefreshTokenHash(USER_ID, TokenHasher.sha256Hex("legacy-rt"),
                TokenHasher.sha256Hex("promoted-rt"))).willReturn(1);
        given(jwtProvider.generateAccessToken(eq(USER_ID), eq(false), anyLong(), any())).willReturn("promoted-at");

        // when
        TokenRefreshResponse response = authService.refreshToken("legacy-rt");

        // then: 수명 판정을 «타지 않는다» — 첫 회전이 세션 축에 올리는 유일한 자리라서다.
        verify(jwtProvider, never()).isRefreshRotationDue(any(), anyBoolean());
        assertThat(response.refreshToken()).isEqualTo("promoted-rt");
        assertThat(response.sessionId()).isEqualTo(SESSION_ID);
        // 승격 행에는 자격이 이때 처음 발급된다
        assertThat(response.deviceBootstrap()).isEqualTo("promoted-bootstrap");
        verify(authSessionService).promoteLegacy(USER_ID, "promoted-rt", null);
        verify(authSessionService, never()).rotateActive(any(), anyString(), anyString());
    }

    @Test
    @DisplayName("세션도 없고 유저 단일 해시와도 어긋나는 RT → 401 (구 RT 부활 금지)")
    void refreshTokenRejectsLegacyHashMismatch() {
        // given: B 기기가 단일 해시를 가져간 뒤 도착한 A 의 «이미 회전된» 구 RT 가 이 모양이다
        User user = User.builder().id(USER_ID).refreshTokenHash(TokenHasher.sha256Hex("device-b-rt")).build();
        given(jwtProvider.extractType("orphan-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("orphan-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("orphan-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(authSessionService.findByRefreshToken("orphan-rt")).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("orphan-rt"))
                .isInstanceOf(InvalidTokenException.class);
        verify(authSessionService, never()).promoteLegacy(any(), anyString(), any());
        verify(userRepository, never()).rotateRefreshTokenHash(any(), anyString(), anyString());
    }

    @Test
    @DisplayName("탈퇴가 먼저 커밋된 유저의 RT → 락 조회가 비어 401, 세션 조회까지 가지 않는다")
    void refreshTokenRejectsWithdrawnUser() {
        // given
        given(jwtProvider.extractType("withdrawn-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("withdrawn-rt")).willReturn(USER_ID);
        given(jwtProvider.extractExpiration("withdrawn-rt")).willReturn(RT_EXPIRES_AT);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("withdrawn-rt"))
                .isInstanceOf(InvalidTokenException.class);
        verify(authSessionService, never()).findByRefreshToken(anyString());
    }

    @Test
    @DisplayName("유효하지 않은 RT → InvalidTokenException")
    void refreshTokenInvalid() {
        // given
        given(jwtProvider.extractType("bad-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("bad-rt")).willThrow(new JwtException("invalid"));

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("bad-rt"))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("access 토큰으로 갱신 시도 → InvalidTokenException (GROMO-714)")
    void refreshTokenRejectsAccessType() {
        // given — refresh 가 아닌 access 타입 토큰
        given(jwtProvider.extractType("access-token")).willReturn(JwtProvider.TYPE_ACCESS);

        // when & then — 타입 가드에서 막혀 DB 조회까지 가지 않는다
        assertThatThrownBy(() -> authService.refreshToken("access-token"))
                .isInstanceOf(InvalidTokenException.class);
        verify(userRepository, never()).findActiveByIdForUpdate(any());
    }

    @Test
    @DisplayName("type 클레임 없는 구 토큰으로 갱신 시도 → InvalidTokenException (fail-closed)")
    void refreshTokenRejectsLegacyTokenWithoutType() {
        // given — 714 이전에 발급돼 type 클레임이 없는 토큰은 extractType 이 null 을 반환한다
        given(jwtProvider.extractType("legacy-rt")).willReturn(null);

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("legacy-rt"))
                .isInstanceOf(InvalidTokenException.class);
        verify(userRepository, never()).findActiveByIdForUpdate(any());
    }

    @Test
    @DisplayName("access 토큰으로 로그아웃 시도 → InvalidTokenException (GROMO-714)")
    void logoutRejectsAccessType() {
        // given
        given(jwtProvider.extractType("access-token")).willReturn(JwtProvider.TYPE_ACCESS);

        // when & then — 남의 세션을 access 토큰으로 끊을 수 없다
        assertThatThrownBy(() -> authService.logout(new LogoutRequest("access-token")))
                .isInstanceOf(InvalidTokenException.class);
        verify(userRepository, never()).findActiveByIdForUpdate(any());
    }
}
