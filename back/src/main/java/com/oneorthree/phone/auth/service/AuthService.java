package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.client.SocialLoginClient;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
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
     * @param nickname Apple fullName처럼 토큰 외 부가정보로 받는 닉네임(없으면 null)
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public SocialLoginResponse socialLogin(Provider provider, String token, String nickname) {
        SocialLoginClient client = socialLoginClients.get(provider);
        if (client == null) {
            throw new IllegalArgumentException("지원하지 않는 소셜 로그인 제공자입니다: " + provider);
        }
        String providerId = client.getProviderId(token);

        try {
            return self.loginOrRegister(provider, providerId, nickname);
        } catch (DataIntegrityViolationException e) {
            // 경쟁에서 진 요청 — 승자가 만든 계정으로 새 트랜잭션에서 1회 재시도(present 분기로 정상 로그인)
            return self.loginOrRegister(provider, providerId, nickname);
        }
    }

    /**
     * 회원 매핑·토큰 발급·로깅 공통 처리. self 프록시로 호출돼 매 시도가 독립 트랜잭션이 되도록 public.
     */
    @Transactional
    public SocialLoginResponse loginOrRegister(Provider provider, String providerId, String nickname) {
        Optional<SocialAccount> socialAccount =
                socialAccountRepository.findByProviderAndProviderId(provider, providerId);

        // 소프트딜리트된 연동 → deletedAt = null 로 복원(재활성화). unique 제약 충돌 방지.
        if (socialAccount.isPresent() && socialAccount.get().getDeletedAt() != null) {
            socialAccount.get().setDeletedAt(null);
        }

        boolean isNewUser = socialAccount.isEmpty();

        User user = socialAccount
                .map(SocialAccount::getUser)
                .orElseGet(() -> {
                    User newUser = userRepository.save(User.builder().build());
                    if (nickname != null) {
                        newUser.setNickname(nickname);
                    }
                    socialAccountRepository.save(SocialAccount.builder()
                            .user(newUser)
                            .provider(provider)
                            .providerId(providerId)
                            .build());
                    createUserSideRows(newUser.getId());
                    return newUser;
                });

        String accessToken = jwtProvider.generateAccessToken(user.getId());
        String refreshToken = jwtProvider.generateRefreshToken(user.getId());
        user.setRefreshToken(refreshToken);

        // 신규 유저만 가입 이벤트 발행 — 재활성화 로그인(isNewUser=false)은 제외
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
        newUser.setRefreshToken(refreshToken);

        // 게스트 생성은 항상 신규 가입
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "guest", "is_guest", true));
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "guest"));
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

        userActivityEventLogger.log(UserActivityEvent.LOGOUT, Map.of());
    }
}
