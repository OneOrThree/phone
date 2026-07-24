package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.client.SocialLoginClient;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import io.jsonwebtoken.JwtException;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class AuthService {

    private final UserRepository userRepository;
    private final UserWalletRepository userWalletRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final JwtProvider jwtProvider;
    private final UserActivityEventLogger userActivityEventLogger;
    private final Map<Provider, SocialLoginClient> socialLoginClients;

    // 자기 자신 프록시 — 동시 첫 로그인 유니크 위반 시 새 트랜잭션으로 재시도하기 위함 (@Lazy 로 순환 주입 방지).
    private final AuthService self;

    public AuthService(UserRepository userRepository,
                       UserWalletRepository userWalletRepository,
                       UserScreenTimeSettingsRepository userScreenTimeSettingsRepository,
                       UserFocusTimeSettingsRepository userFocusTimeSettingsRepository,
                       UserNotificationSettingsRepository userNotificationSettingsRepository,
                       SocialAccountRepository socialAccountRepository,
                       JwtProvider jwtProvider,
                       UserActivityEventLogger userActivityEventLogger,
                       List<SocialLoginClient> socialLoginClients,
                       @Lazy AuthService self) {
        this.userRepository = userRepository;
        this.userWalletRepository = userWalletRepository;
        this.userScreenTimeSettingsRepository = userScreenTimeSettingsRepository;
        this.userFocusTimeSettingsRepository = userFocusTimeSettingsRepository;
        this.userNotificationSettingsRepository = userNotificationSettingsRepository;
        this.socialAccountRepository = socialAccountRepository;
        this.jwtProvider = jwtProvider;
        this.userActivityEventLogger = userActivityEventLogger;
        this.socialLoginClients = socialLoginClients.stream()
                .collect(Collectors.toMap(SocialLoginClient::provider, client -> client));
        this.self = self;
    }

    // 회원 생성 시 1:1 부속 테이블(지갑·스크린타임·포커스·알림 설정) row를 함께 만든다.
    private void createUserSideRows(UUID userId) {
        userWalletRepository.save(UserWallet.builder().userId(userId).build());
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder().userId(userId).build());
        userFocusTimeSettingsRepository.save(UserFocusTimeSettings.builder().userId(userId).build());
        userNotificationSettingsRepository.save(UserNotificationSettings.builder().userId(userId).build());
    }

    /**
     * 소셜 로그인 진입점 (Google/Apple/Kakao/Line/Instagram) — provider 검증·providerId 추출은 트랜잭션 밖에서.
     *
     * 동시 첫 로그인 경쟁(TOCTOU): 같은 소셜 계정으로 두 요청이 동시에 최초 로그인하면 둘 다 "없음"으로 보고
     * 생성 시도 → (provider, provider_id) 유니크 제약으로 한쪽 커밋 시 {@link DataIntegrityViolationException}.
     * 유니크 위반은 flush/커밋 시점에 나므로 트랜잭션 내부에서 잡을 수 없어, self 프록시로 새 트랜잭션을 열어 1회
     * 재시도한다(재시도 시 승자가 만든 계정이 보여 present 분기로 정상 로그인). 래퍼는 클래스 레벨
     * readOnly 트랜잭션에 묶이지 않도록 NOT_SUPPORTED.
     *
     * 닉네임은 가입 시점에 세팅하지 않는다 — 온보딩(setupProfile)에서 @NotBlank 로 필수 입력받는다(GROMO-584).
     * (과거 Apple fullName 프리필은 users.nickname 유니크 제약과 동명이인 충돌을 일으켜 제거함)
     *
     * 게스트→소셜 업그레이드(GROMO-585): /auth/* 는 JwtFilter 화이트리스트라 userId 가 request attribute 로
     * 세팅되지 않는다. 게스트는 자신의 게스트 JWT 를 Authorization 헤더로 보내므로, 여기서 유효 토큰이 있으면
     * (기존 인증 흐름을 건드리지 않고) 선택적으로 파싱해 loginOrRegister 에 currentUserId 로 넘긴다.
     * 토큰이 없거나 무효면 empty → 기존 신규 가입 흐름.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public SocialLoginResponse socialLogin(Provider provider, String token, String authorizationHeader) {
        SocialLoginClient client = socialLoginClients.get(provider);
        if (client == null) {
            throw new IllegalArgumentException("지원하지 않는 소셜 로그인 제공자입니다: " + provider);
        }
        String providerId = client.getProviderId(token);
        UUID currentUserId = resolveCurrentUserId(authorizationHeader);

        try {
            return self.loginOrRegister(provider, providerId, currentUserId);
        } catch (DataIntegrityViolationException e) {
            // 소셜 계정 경쟁에서 진 요청 — 승자가 만든 계정으로 새 트랜잭션에서 1회 재시도(present 분기로 정상 로그인).
            // 가입 시 nickname 을 세팅하지 않으므로 여기서 잡히는 DIVE 는 (provider, provider_id) 위반뿐이다.
            return self.loginOrRegister(provider, providerId, currentUserId);
        }
    }

    /**
     * Authorization 헤더에서 현재 로그인(게스트) 사용자 id 를 선택적으로 추출한다.
     * 헤더가 없거나 Bearer 형식이 아니거나 토큰이 무효면 empty(=신규 가입 흐름). JwtFilter 를 바꾸지 않기 위해
     * 여기서만 optional 파싱한다 — 유효할 때만 파싱하므로 무효 토큰이 로그인 자체를 막지는 않는다.
     */
    // 여기에는 타입 가드를 넣지 않는다 (GROMO-714) — 게스트는 자신의 access 토큰을 헤더로 보내므로
    // refresh 타입을 요구하면 게스트→소셜 업그레이드가 깨진다. /auth/* 는 JwtFilter 화이트리스트라 필터 가드도 타지 않는다.
    private UUID resolveCurrentUserId(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
            return null;
        }
        String token = authorizationHeader.substring(7);
        if (!jwtProvider.isTokenValid(token)) {
            return null;
        }
        return jwtProvider.extractUserId(token);
    }

    /**
     * 회원 매핑·토큰 발급·로깅 공통 처리. self 프록시로 호출돼 매 시도가 독립 트랜잭션이 되도록 public.
     *
     * currentUserId(게스트 JWT 로 추출된 현재 사용자)가 게스트면 게스트→소셜 업그레이드 분기를 탄다(GROMO-585):
     * - 소셜 계정 이미 존재 → 이미 가입된 계정이므로 업그레이드 거부(SOCIAL_ACCOUNT_ALREADY_LINKED), 게스트 유지.
     * - 소셜 계정 미존재 → 기존 게스트 User 를 재활용(isGuest=false + SocialAccount 부착)해 게스트가 쌓은
     *   FK 데이터를 보존한다. 부속 테이블(createUserSideRows)은 게스트 생성 시 이미 만들어졌으므로 재호출하지 않는다.
     * currentUserId 가 없거나 게스트가 아니면 기존 동작(신규 소셜은 새 User 생성).
     */
    @Transactional
    public SocialLoginResponse loginOrRegister(Provider provider, String providerId, UUID currentUserId) {
        Optional<SocialAccount> socialAccount =
                socialAccountRepository.findByProviderAndProviderId(provider, providerId);

        // 소프트딜리트된 연동 → deletedAt = null 로 복원(재활성화). unique 제약 충돌 방지.
        if (socialAccount.isPresent() && socialAccount.get().getDeletedAt() != null) {
            socialAccount.get().setDeletedAt(null);
        }

        // 현재 호출자가 게스트인 경우에만 업그레이드 분기 대상 (비게스트/미존재는 null → 기존 흐름)
        User guestUser = currentUserId == null ? null
                : userRepository.findByIdAndIsDeletedFalse(currentUserId).filter(User::isGuest).orElse(null);

        boolean isNewUser;
        User user;

        if (socialAccount.isPresent()) {
            if (guestUser != null) {
                // 게스트가 이미 다른 계정에 연동된 소셜로 업그레이드 시도 → 거부(게스트 유지)
                throw new AuthException(AuthErrorCode.SOCIAL_ACCOUNT_ALREADY_LINKED);
            }
            user = socialAccount.get().getUser();
            isNewUser = false;
        } else if (guestUser != null) {
            // 게스트→소셜 업그레이드: 기존 게스트 User 재활용(FK 데이터 보존), 부속 row 재생성 금지
            guestUser.setGuest(false);
            socialAccountRepository.save(SocialAccount.builder()
                    .user(guestUser)
                    .provider(provider)
                    .providerId(providerId)
                    .build());
            user = guestUser;
            isNewUser = false;
        } else {
            User newUser = userRepository.save(User.builder().build());
            socialAccountRepository.save(SocialAccount.builder()
                    .user(newUser)
                    .provider(provider)
                    .providerId(providerId)
                    .build());
            createUserSideRows(newUser.getId());
            user = newUser;
            isNewUser = true;
        }

        String accessToken = jwtProvider.generateAccessToken(user.getId());
        String refreshToken = jwtProvider.generateRefreshToken(user.getId());
        // RT 원본은 응답으로만 내려가고 DB 에는 해시만 남긴다 — DB 유출 시 재사용 차단 (GROMO-713)
        user.setRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));

        // 신규 유저만 가입 이벤트 발행 — 재활성화 로그인·게스트 업그레이드(isNewUser=false)는 제외
        if (isNewUser) {
            userActivityEventLogger.log(user.getId().toString(), UserActivityEvent.USER_SIGNED_UP,
                    Map.of("method", provider.name().toLowerCase(), "is_guest", false));
        }
        userActivityEventLogger.log(user.getId().toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", isNewUser, "method", provider.name().toLowerCase()));

        return new SocialLoginResponse(accessToken, refreshToken, isNewUser);
    }

    @Transactional
    public GuestLoginResponse guestLogin() {
        User newUser = userRepository.save(User.builder().isGuest(true).build());
        createUserSideRows(newUser.getId());

        String accessToken = jwtProvider.generateAccessToken(newUser.getId());
        String refreshToken = jwtProvider.generateRefreshToken(newUser.getId());
        newUser.setRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));

        // 게스트 생성은 항상 신규 가입
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "guest", "is_guest", true));
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "guest"));
        return new GuestLoginResponse(accessToken, refreshToken, newUser.isGuest());
    }

    public TokenRefreshResponse refreshToken(String refreshToken) {
        // refresh 타입만 허용 (GROMO-714) — access·구 토큰(type 없음 = null)은 거부한다.
        // 가드가 try 안에 있어야 extractType 이 만료·서명오류에 던지는 JwtException 도 401 로 변환된다
        // (InvalidTokenException 은 RuntimeException 이라 아래 catch 에 걸리지 않는다).
        try {
            if (!JwtProvider.TYPE_REFRESH.equals(jwtProvider.extractType(refreshToken))) {
                throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
            }
            jwtProvider.extractUserId(refreshToken);

        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        // 조회도 해시로 — 저장과 같은 변환을 거쳐야 매칭된다 (GROMO-713)
        User user = userRepository.findByRefreshTokenHash(TokenHasher.sha256Hex(refreshToken))
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));

        String newAccessToken = jwtProvider.generateAccessToken(user.getId());
        return new TokenRefreshResponse(newAccessToken);
    }

    @Transactional
    public void logout(String refreshToken) {
        // refreshToken() 과 동일한 refresh 타입 가드 — access 토큰으로 세션을 끊지 못하게 한다 (GROMO-714).
        try {
            if (!JwtProvider.TYPE_REFRESH.equals(jwtProvider.extractType(refreshToken))) {
                throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
            }
            jwtProvider.extractUserId(refreshToken);
        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        User user = userRepository.findByRefreshTokenHash(TokenHasher.sha256Hex(refreshToken))
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));

        user.setRefreshTokenHash(null);

        userActivityEventLogger.log(UserActivityEvent.LOGOUT, Map.of());
    }
}
