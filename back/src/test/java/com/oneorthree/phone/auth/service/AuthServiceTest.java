package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.client.SocialLoginClient;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
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
import org.mockito.InOrder;
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
import static org.mockito.Mockito.inOrder;
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
    private static final UUID GUEST_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(savedUser));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

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
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(existingUser));
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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(savedUser));
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
    @DisplayName("Apple 신규 로그인 → nickname 은 세팅하지 않음(온보딩에서 입력), method=apple 로깅")
    void socialLoginAppleDoesNotSetNickname() {
        // given
        User savedUser = User.builder().id(USER_ID).build();
        given(appleClient.getProviderId("apple-token")).willReturn("apple-sub");
        given(socialAccountRepository.findByProviderAndProviderId(Provider.APPLE, "apple-sub"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(savedUser));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(existingUser));
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
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(existingUser));
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
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> authService.socialLogin(Provider.KAKAO, "kakao-token", null))
                .isInstanceOf(UserException.class)
                .hasFieldOrPropertyWithValue("errorCode", UserErrorCode.NOT_FOUND);
        // 토큰 상태 변경 없음 — 발급 자체가 시작되지 않는다
        assertThat(existingUser.getRefreshTokenHash()).isNull();
        verify(jwtProvider, never()).generateAccessToken(any(UUID.class));
        verify(jwtProvider, never()).generateRefreshToken(any(UUID.class));
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
        // 게스트 로드가 곧 배타 락 조회다 (GROMO-801 codex 2차) — setGuest(false) 등 변경보다 락이
        // 먼저여야 한다. 토큰 발급 전 재검증도 같은 조회를 다시 타므로 스텁 하나가 두 호출을 받는다.
        given(userRepository.findActiveByIdForUpdate(GUEST_ID)).willReturn(Optional.of(guestUser));
        given(jwtProvider.generateAccessToken(GUEST_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(GUEST_ID)).willReturn("refresh-token");

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
        given(userRepository.findActiveByIdForUpdate(GUEST_ID)).willReturn(Optional.of(guestUser));

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
    @DisplayName("탈퇴 게스트의 유효한 토큰은 소셜 업그레이드에 사용되지 않고 새 가입으로 처리된다")
    void softDeletedGuestTokenDoesNotUpgradeDeletedUser() {
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("deleted-guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("deleted-guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("deleted-guest-jwt")).willReturn(GUEST_ID);
        // 탈퇴 유저는 활성 조회(배타 락)에서 제외돼 게스트 업그레이드 대상이 아니다.
        given(userRepository.findActiveByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(savedUser));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer deleted-guest-jwt");

        assertThat(response.isNewUser()).isTrue();
        // 게스트 로드는 배타 락 조회여야 한다 — 락 없는 활성 조회·raw findById 는 쓰지 않는다 (GROMO-801)
        verify(userRepository).findActiveByIdForUpdate(GUEST_ID);
        verify(userRepository, never()).findByIdAndIsDeletedFalse(GUEST_ID);
        verify(userRepository, never()).findById(GUEST_ID);
    }

    @Test
    @DisplayName("게스트 승격 락은 변경보다 먼저다 — 탈퇴 선커밋 게스트는 승격 분기에 진입하지 못한다 (GROMO-801 codex 2차)")
    void guestUpgradeLockPrecedesMutation() {
        // 락이 뒤(토큰 발급 전 재검증)에만 있으면 setGuest(false)·소셜 연동 저장이 먼저 실행되고,
        // 재검증 쿼리 직전 auto-flush 가 그 언버전 UPDATE 를 락 획득 전에 내보내 탈퇴를 덮어쓴다.
        // 게스트 로드 자체가 락 조회이면, 탈퇴 선커밋 게스트는 변경 없이 신규 가입 흐름으로 빠진다.
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("guest-jwt")).willReturn(true);
        given(jwtProvider.extractType("guest-jwt")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("guest-jwt")).willReturn(GUEST_ID);
        given(userRepository.findActiveByIdForUpdate(GUEST_ID)).willReturn(Optional.empty());
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(savedUser));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer guest-jwt");

        assertThat(response.isNewUser()).isTrue();
        // 락 조회(게스트 로드)가 어떤 저장(mutation)보다도 앞이다
        InOrder lockFirst = inOrder(userRepository, socialAccountRepository);
        lockFirst.verify(userRepository).findActiveByIdForUpdate(GUEST_ID);
        lockFirst.verify(socialAccountRepository).save(any(SocialAccount.class));
    }

    @Test
    @DisplayName("refresh 토큰으로는 게스트 업그레이드를 할 수 없다 — 새 가입으로 처리 (GROMO-714)")
    void refreshTokenCannotUpgradeGuest() {
        // given — /auth/* 는 JwtFilter 화이트리스트라 필터 타입 가드를 타지 않는다.
        // 서명이 유효한 refresh 토큰을 Authorization 헤더로 보내 게스트를 승격시키려는 시도.
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("stolen-rt")).willReturn(true);
        given(jwtProvider.extractType("stolen-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(savedUser));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        // when
        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer stolen-rt");

        // then — 타입 가드에서 걸러져 currentUserId 가 null → 업그레이드가 아닌 신규 가입 흐름
        assertThat(response.isNewUser()).isTrue();
        verify(jwtProvider, never()).extractUserId("stolen-rt");
        verify(userRepository, never()).findByIdAndIsDeletedFalse(any(UUID.class));
    }

    @Test
    @DisplayName("type 클레임 없는 구 토큰으로는 게스트 업그레이드를 할 수 없다 (fail-closed)")
    void legacyTokenWithoutTypeCannotUpgradeGuest() {
        User savedUser = User.builder().id(USER_ID).build();
        given(kakaoClient.getProviderId("kakao-token")).willReturn("12345");
        given(jwtProvider.isTokenValid("legacy-jwt")).willReturn(true);
        given(jwtProvider.extractType("legacy-jwt")).willReturn(null);
        given(socialAccountRepository.findByProviderAndProviderId(Provider.KAKAO, "12345"))
                .willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willReturn(savedUser);
        // 토큰 발급 전 탈퇴 직렬화 재검증(배타 락) 스텁 (GROMO-801)
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(savedUser));
        given(jwtProvider.generateAccessToken(USER_ID)).willReturn("access-token");
        given(jwtProvider.generateRefreshToken(USER_ID)).willReturn("refresh-token");

        SocialLoginResponse response =
                authService.socialLogin(Provider.KAKAO, "kakao-token", "Bearer legacy-jwt");

        assertThat(response.isNewUser()).isTrue();
        verify(jwtProvider, never()).extractUserId("legacy-jwt");
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
        given(jwtProvider.extractType("valid-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        // 조회 키는 원본 RT 가 아니라 그 해시여야 한다 — 서비스가 해싱을 빠뜨리면 stub 이 매칭되지 않아 실패한다 (GROMO-713)
        given(userRepository.findByRefreshTokenHash(TokenHasher.sha256Hex("valid-rt")))
                .willReturn(Optional.of(user));
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
        given(jwtProvider.extractType("bad-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(jwtProvider.extractUserId("bad-rt")).willThrow(new JwtException("invalid"));

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("bad-rt"))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("DB에 없는 RT → InvalidTokenException")
    void refreshTokenNotFoundInDb() {
        // given
        given(jwtProvider.extractType("orphan-rt")).willReturn(JwtProvider.TYPE_REFRESH);
        given(userRepository.findByRefreshTokenHash(TokenHasher.sha256Hex("orphan-rt")))
                .willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("orphan-rt"))
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
        verify(userRepository, never()).findByRefreshTokenHash(anyString());
    }

    @Test
    @DisplayName("type 클레임 없는 구 토큰으로 갱신 시도 → InvalidTokenException (fail-closed)")
    void refreshTokenRejectsLegacyTokenWithoutType() {
        // given — 714 이전에 발급돼 type 클레임이 없는 토큰은 extractType 이 null 을 반환한다
        given(jwtProvider.extractType("legacy-rt")).willReturn(null);

        // when & then
        assertThatThrownBy(() -> authService.refreshToken("legacy-rt"))
                .isInstanceOf(InvalidTokenException.class);
        verify(userRepository, never()).findByRefreshTokenHash(anyString());
    }

    @Test
    @DisplayName("access 토큰으로 로그아웃 시도 → InvalidTokenException (GROMO-714)")
    void logoutRejectsAccessType() {
        // given
        given(jwtProvider.extractType("access-token")).willReturn(JwtProvider.TYPE_ACCESS);

        // when & then — 남의 세션을 access 토큰으로 끊을 수 없다
        assertThatThrownBy(() -> authService.logout("access-token"))
                .isInstanceOf(InvalidTokenException.class);
        verify(userRepository, never()).findByRefreshTokenHash(anyString());
    }
}
