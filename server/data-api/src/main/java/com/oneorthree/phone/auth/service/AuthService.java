package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.client.SocialLoginClient;
import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.repository.GuestDeviceClaimRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.repository.domain.GuestDeviceClaim;
import com.oneorthree.phone.common.support.InternalCommands;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import com.oneorthree.phone.user.support.OnboardingCompletion;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.auth.support.JwtProvider;
import io.jsonwebtoken.JwtException;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 소셜·게스트 로그인과 토큰 수명주기를 담당한다.
 *
 * <p>가입은 {@code users} 한 행으로 끝나지 않는다 — 지갑·스크린타임·포커스·알림 설정 4개
 * 부속 행을 함께 만들어야 이후 조회가 빈 값을 만나지 않는다({@code createUserSideRows}).
 *
 * <p>게스트→소셜 업그레이드(GROMO-585)가 이 클래스의 까다로운 축이다. {@code /auth/*} 는
 * {@code JwtFilter} 화이트리스트라 인증 컨텍스트가 없어, 게스트가 보낸 Authorization 헤더를
 * 여기서 직접 파싱해 기존 게스트 User 를 재활용할지 판단한다. 동시 승격 경쟁은
 * 게스트 락 조회와 토큰의 guest 클레임을 함께 봐 패자를 가려낸다(GROMO-1229).
 */
@Service
@Transactional(readOnly = true)
public class AuthService {

    private final UserRepository userRepository;
    private final UserQueryService userQueryService;
    private final UserWalletRepository userWalletRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final JwtProvider jwtProvider;
    private final UserActivityEventLogger userActivityEventLogger;
    /**
     * 세션 축 (A22 ㋣ · ㋞) — {@code users.refresh_token_hash} 옆에 «병행»으로 세션 행을 쓴다.
     * 기존 경로를 대체하지 않는 이유는 ㋪ 에 있다: 구 RT 에는 {@code sessionId} 가 없어서, 곧장
     * 전환하면 최대 RT 수명 동안 구 토큰을 든 사용자가 전부 끊긴다(게스트에겐 계정 소실이다).
     */
    private final AuthSessionService authSessionService;
    /**
     * 기기 토큰 삭제 명령 (A22 ㋗) — 로그아웃과 같은 트랜잭션에서 적는다. 앱의 별개 {@code DELETE}
     * 요청은 만료된 AT 로 401 이 되면 아무 기록도 남기지 못한다.
     */
    private final UserSatelliteCommandService userSatelliteCommandService;
    private final Map<Provider, SocialLoginClient> socialLoginClients;
    private final GuestDeviceClaimRepository guestDeviceClaimRepository;
    private final Clock clock;

    /**
     * 게스트 기기 점유의 복구 창 (GROMO-2036).
     *
     * <p>{@code LoginAttemptService.RECOVERY_WINDOW} 와 <b>같은 근거·같은 길이</b>다 — 막으려는 것이
     * 「유실된 201 의 즉시 재시도」 하나이기 때문이다. 더 길게 잡으면 기기 식별자가 게스트 계정의
     * 장기 bearer 자격이 되는데, 계정 LLD §3 은 「게스트의 복구창 밖 처리에는 아직 승인된 대체 복구
     * 수단이 없다」(Q06)고 명시한다. 그 미결을 여기서 임의로 확정하지 않는다.
     */
    private static final Duration GUEST_DEVICE_RECOVERY_WINDOW = Duration.ofMinutes(5);

    /**
     * 자기 자신 프록시 — 동시 첫 로그인 유니크 위반 시 새 트랜잭션으로 재시도하기 위함 (@Lazy 로 순환 주입 방지).
     */
    private final AuthService self;

    /**
     * @param userRepository                    회원 본체
     * @param userQueryService                  회원 단건 조회 계층 (GROMO-1655)
     * @param userWalletRepository              가입 시 함께 만드는 지갑 부속 행
     * @param userScreenTimeSettingsRepository  가입 시 함께 만드는 스크린타임 설정 부속 행
     * @param userFocusTimeSettingsRepository   가입 시 함께 만드는 포커스 설정 부속 행
     * @param userNotificationSettingsRepository 가입 시 함께 만드는 알림 설정 부속 행
     * @param socialAccountRepository           provider·providerId 연동 행
     * @param jwtProvider                       AT·RT 발급과 클레임 추출
     * @param userActivityEventLogger           가입·로그인 활동 로그
     * @param authSessionService                세션 축 쓰기 — 로그인·회전·로그아웃과 같은 트랜잭션에서 돈다
     * @param userSatelliteCommandService       기기 토큰 삭제 명령 — 로그아웃 트랜잭션에서 함께 적는다
     * @param socialLoginClients                provider 별 구현 — {@link SocialLoginClient#provider} 키로 맵을 만든다
     * @param guestDeviceClaimRepository        게스트 기기 점유 원장 (GROMO-2036) — 같은 기기의 재시도가
     *                                          계정을 하나 더 만들지 않게 하는 축
     * @param clock                             기기 점유 복구 창 판정용 시계 — 테스트가 고정한다
     * @param self                              자기 프록시. 첫 로그인 유니크 위반을 새 트랜잭션으로
     *                                          재시도하기 위해 필요하다({@code @Lazy} 로 순환 주입 회피)
     */
    public AuthService(UserRepository userRepository,
                       UserQueryService userQueryService,
                       UserWalletRepository userWalletRepository,
                       UserScreenTimeSettingsRepository userScreenTimeSettingsRepository,
                       UserFocusTimeSettingsRepository userFocusTimeSettingsRepository,
                       UserNotificationSettingsRepository userNotificationSettingsRepository,
                       SocialAccountRepository socialAccountRepository,
                       JwtProvider jwtProvider,
                       UserActivityEventLogger userActivityEventLogger,
                       AuthSessionService authSessionService,
                       UserSatelliteCommandService userSatelliteCommandService,
                       List<SocialLoginClient> socialLoginClients,
                       GuestDeviceClaimRepository guestDeviceClaimRepository,
                       Clock clock,
                       @Lazy AuthService self) {
        this.userRepository = userRepository;
        this.userQueryService = userQueryService;
        this.userWalletRepository = userWalletRepository;
        this.userScreenTimeSettingsRepository = userScreenTimeSettingsRepository;
        this.userFocusTimeSettingsRepository = userFocusTimeSettingsRepository;
        this.userNotificationSettingsRepository = userNotificationSettingsRepository;
        this.socialAccountRepository = socialAccountRepository;
        this.jwtProvider = jwtProvider;
        this.userActivityEventLogger = userActivityEventLogger;
        this.authSessionService = authSessionService;
        this.userSatelliteCommandService = userSatelliteCommandService;
        this.socialLoginClients = socialLoginClients.stream()
                .collect(Collectors.toMap(SocialLoginClient::provider, client -> client));
        this.guestDeviceClaimRepository = guestDeviceClaimRepository;
        this.clock = clock;
        this.self = self;
    }

    /**
     * 회원 생성 시 1:1 부속 테이블(지갑·스크린타임·포커스·알림 설정) row를 함께 만든다.
     */
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
     * 헤더가 없을 때만 신규 가입 흐름이고, 무효한 AT 는 401 로 거절한다 (GROMO-1929).
     *
     * @param provider            소셜 제공자 — 지원하지 않으면 {@link IllegalArgumentException}
     * @param token               제공자가 발급한 토큰. 여기서 providerId 를 얻는다
     * @param authorizationHeader 게스트 업그레이드 판정용 자체 AT. 헤더가 없을 때만 신규 가입으로
     *                            흐르고, 무효·폐기 세션의 AT 면 401 로 거절한다 (GROMO-1929)
     * @return 발급된 AT·RT 와 게스트 여부
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public SocialLoginResponse socialLogin(Provider provider, String token, String authorizationHeader) {
        return loginWithProviderId(provider, verifyProviderId(provider, token), authorizationHeader);
    }

    /**
     * 제공자에게 자격을 검증시키고 provider 측 식별자만 얻는다 — <b>부수효과도 DB 접근도 없다</b>.
     *
     * <p>{@link #socialLogin} 에서 갈라낸 이유는 GROMO-1994(확인 후 계정 전환)다. 전환을 확정하려면
     * 「이 소셜 계정이 이미 다른 사용자에게 붙어 있는가」를 <b>로그인 트랜잭션에 들어가기 전에</b>
     * 알아야 하는데, 그 판정의 입력이 providerId 다. 합쳐 두면 L10 조합 층이 같은 일회성 자격으로
     * 제공자를 <b>두 번</b> 불러야 한다(kakao·line·instagram 은 실제 HTTP 왕복이다).
     *
     * <p>{@code NOT_SUPPORTED} 가 <b>반드시</b> 필요하다. 클래스 기본이 {@code @Transactional(readOnly
     * = true)} 라, 이 메서드를 프록시로 부르는 바깥(L10 조합 층)에서는 제공자 왕복 내내 읽기 전용
     * 트랜잭션과 DB 커넥션을 쥐게 된다 — {@link #socialLogin} 이 같은 이유로 같은 전파를 쓴다.
     *
     * @throws AuthException 400 {@code UNSUPPORTED_PROVIDER} — 어댑터가 없는 제공자 (GROMO-1725)
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public String verifyProviderId(Provider provider, String token) {
        SocialLoginClient client = socialLoginClients.get(provider);
        if (client == null) {
            throw new AuthException(AuthErrorCode.UNSUPPORTED_PROVIDER);   // 400 (GROMO-1725)
        }
        return client.getProviderId(token);
    }

    /**
     * 검증이 끝난 providerId 로 회원 매핑·토큰 발급까지 수행한다.
     *
     * @param authorizationHeader 선택 AT. {@code null} 이면 승격·전환 판정 없이 대상 계정 로그인이다
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public SocialLoginResponse loginWithProviderId(Provider provider, String providerId,
                                                   String authorizationHeader) {
        CallerToken caller = resolveCaller(authorizationHeader);

        try {
            return self.loginOrRegister(provider, providerId, caller.userId(), caller.guestClaim(),
                    caller.sessionId(), caller.authGeneration());
        } catch (DataIntegrityViolationException e) {
            // 소셜 계정 경쟁에서 진 요청 — 승자가 만든 계정으로 새 트랜잭션에서 1회 재시도(present 분기로 정상 로그인).
            // 가입 시 nickname 을 세팅하지 않으므로 여기서 잡히는 DIVE 는 (provider, provider_id) 위반뿐이다.
            return self.loginOrRegister(provider, providerId, caller.userId(), caller.guestClaim(),
                    caller.sessionId(), caller.authGeneration());
        }
    }

    /**
     * Authorization 헤더에서 추출한 현재 호출자 정보 (GROMO-1229).
     * guestClaim 은 요청 AT 의 guest 클레임(발급 시점 게스트 여부) — 클레임 없는 구 토큰은 null 이고,
     * 호출부는 null 을 비게스트로 간주한다(현행 폴백 유지, 점진 적용).
     * sessionId·authGeneration 은 세션 폐기 관문({@link #checkCallerSessionActive})의 입력이다 (GROMO-1929).
     */
    private record CallerToken(UUID userId, Boolean guestClaim, UUID sessionId, Long authGeneration) {
        private static final CallerToken ANONYMOUS = new CallerToken(null, null, null, null);
    }

    /**
     * Authorization 헤더에서 현재 로그인(게스트) 사용자 id·guest 클레임·세션 식별을 추출한다.
     * <b>헤더가 없을 때만</b> ANONYMOUS(=신규 가입 흐름)다 — 헤더가 있는데 Bearer 형식이 아니거나
     * 서명·만료·타입 검증에 걸리면 401 로 거절한다 (GROMO-1929). 종전엔 그 경우들도 조용히
     * ANONYMOUS 로 강등돼, 만료·위조 AT 를 든 요청이 신규 가입 분기로 흘러 빈 계정을 만들었다.
     * 세션 폐기·세대 검사는 {@link #checkCallerSessionActive} 의 몫이고, 여기선 토큰 자체의 유효성만 본다.
     */
    // access 타입만 인정한다 (GROMO-714) — /auth/* 는 JwtFilter 화이트리스트라 필터의 타입 가드를 타지 않는다.
    // 여기가 무제한이면 서명만 유효한 refresh 토큰(또는 type 없는 구 토큰)으로도 게스트를 소셜 계정으로 승격시켜
    // 새 토큰을 받아갈 수 있어, refresh 토큰에 non-refresh 용도가 생기고 fail-closed 컷오버가 뚫린다.
    // 게스트는 원래 자신의 access 토큰을 헤더로 보내므로 access 를 요구해도 정상 흐름은 그대로다.
    private CallerToken resolveCaller(String authorizationHeader) {
        if (authorizationHeader == null) {
            return CallerToken.ANONYMOUS;
        }
        if (!authorizationHeader.startsWith("Bearer ")) {
            throw new InvalidTokenException(InvalidTokenErrorCode.ACCESS_TOKEN);
        }
        String token = authorizationHeader.substring(7);
        if (!jwtProvider.isTokenValid(token)
                || !JwtProvider.TYPE_ACCESS.equals(jwtProvider.extractType(token))) {
            throw new InvalidTokenException(InvalidTokenErrorCode.ACCESS_TOKEN);
        }
        // guest 클레임은 토큰을 파싱하는 여기서 함께 뽑아 loginOrRegister 로 넘긴다 (GROMO-1229) —
        // 신규 가입 폴백에서 정식 "계정 전환"(비게스트 AT)과 "이미 승격된 게스트의 패자 요청"을
        // 구분하는 유일한 신호다 (DB 상태만으로는 두 경우가 동일하게 보인다).
        return new CallerToken(jwtProvider.extractUserId(token), jwtProvider.extractIsGuest(token),
                jwtProvider.extractSessionId(token), jwtProvider.extractAuthGeneration(token));
    }

    /**
     * 선택 AT 의 세션 폐기 판정 — <b>호출 트랜잭션 안에서만</b> 부른다 (GROMO-1929).
     *
     * <p>{@code LoginAttemptService#gateOptionalSession} (GROMO-1908, 계정 LLD §2.1) 과 <b>같은
     * 술어</b>다 — auth 는 internal 을 참조할 수 없어(도메인 높이) 여기에 둔다. 주체 활성
     * (비활성 404)은 호출부가 caller 를 resolve 할 때 이미 거른 뒤고, 여기선 sid·세대(없거나
     * 어긋나면 거절) → 세션 행 활성 순으로 판정한다. 서명·만료·타입은 {@code resolveCaller} 의 몫.
     *
     * @throws AuthException 401 {@code LEGACY_SESSION_NOT_ACTIVE} — legacy 경로는 Business 매핑
     *                       없이 앱에 직접 닿으므로 공개 401 을 enum 에 새겼다 (내부 경로의 403
     *                       {@code SESSION_NOT_ACTIVE} 와 같은 판정·다른 공개 상태)
     */
    private void checkCallerSessionActive(User caller, UUID sessionId, Long authGeneration) {
        if (sessionId == null || authGeneration == null
                || authGeneration.longValue() != caller.getAuthGeneration()
                || authSessionService.verifySession(caller.getId(), sessionId)
                        .filter(AuthSession::isActive).isEmpty()) {
            throw new AuthException(AuthErrorCode.LEGACY_SESSION_NOT_ACTIVE);
        }
    }

    /**
     * 회원 매핑·토큰 발급·로깅 공통 처리. self 프록시로 호출돼 매 시도가 독립 트랜잭션이 되도록 public.
     *
     * currentUserId(게스트 JWT 로 추출된 현재 사용자)가 게스트면 게스트→소셜 업그레이드 분기를 탄다(GROMO-585):
     * - 소셜 계정 이미 존재 → 이미 가입된 계정이므로 업그레이드 거부(SOCIAL_ACCOUNT_ALREADY_LINKED), 게스트 유지.
     * - 소셜 계정 미존재 → 기존 게스트 User 를 재활용(isGuest=false + SocialAccount 부착)해 게스트가 쌓은
     *   FK 데이터를 보존한다. 부속 테이블(createUserSideRows)은 게스트 생성 시 이미 만들어졌으므로 재호출하지 않는다.
     * currentUserId 가 없거나 게스트가 아니면 기존 동작(신규 소셜은 새 User 생성).
     *
     * callerGuestClaim 은 요청 AT 의 guest 클레임(발급 시점 게스트 여부, GROMO-1229) — true 이면서
     * 게스트 락 조회가 비고 그 유저가 활성 비게스트로 존재하면, 동시 다른-소셜 승격 경쟁의 패자로
     * 판정해 신규 가입 폴백 대신 GUEST_ALREADY_PROMOTED 로 거절한다. 구 토큰(null)은 비게스트 간주.
     *
     * @param provider         소셜 제공자
     * @param providerId       제공자 측 사용자 식별자
     * @param currentUserId    요청 AT 에서 뽑은 현재 사용자. {@code null} 이면 업그레이드 분기를 타지 않는다
     * @param callerGuestClaim 요청 AT 의 guest 클레임(발급 시점 게스트 여부). {@code null}(구 토큰)은
     *                         비게스트로 간주한다
     * @param callerSessionId      요청 AT 의 {@code sid} 클레임 — 세션 폐기 관문 입력 (GROMO-1929)
     * @param callerAuthGeneration 요청 AT 의 {@code gen} 클레임 — 세대 일치 관문 입력 (GROMO-1929)
     * @return 발급된 AT·RT 와 게스트 여부
     */
    @Transactional
    public SocialLoginResponse loginOrRegister(Provider provider, String providerId, UUID currentUserId,
                                               Boolean callerGuestClaim, UUID callerSessionId,
                                               Long callerAuthGeneration) {
        Optional<SocialAccount> socialAccount =
                socialAccountRepository.findByProviderAndProviderId(provider, providerId);

        // 현재 호출자가 게스트인 경우에만 업그레이드 분기 대상 (비게스트/미존재는 null → 기존 흐름).
        // 처음부터 **배타 락**으로 로드한다 (GROMO-801, codex 리뷰 2·3차).
        //  · 락이 토큰 발급 직전 재검증에만 있으면 승격 분기의 setGuest(false)·소셜 연동 저장이 이미
        //    실행된 뒤라, 재검증 쿼리 직전의 auto-flush 가 그 언버전 full-row UPDATE 를 락 획득 전에
        //    내보낸다 — 탈퇴가 먼저 커밋됐으면 그 flush 가 is_deleted=true 를 덮어쓰고 재검증은
        //    "활성"을 관측해 토큰까지 발급된다. 변경 전에 락이 먼저다.
        //  · 공유 락이면 같은 게스트를 동시에 승격하는 두 요청이 둘 다 FOR SHARE 를 쥔 채 users
        //    UPDATE(isGuest·refreshTokenHash) 승급을 기다리며 교착한다 — 이 트랜잭션은 users 행을
        //    변경하므로 처음부터 배타 락이 원칙이다(UserRepository 락 선택 원칙). 탈퇴와의 직렬화
        //    성질은 배타 락에서도 그대로고, 탈퇴 선커밋 게스트는 빈 결과 → 신규 가입 흐름을 탄다.
        //  · 잠그는 대상은 **활성 게스트 행뿐**이다(isGuest 술어, codex 리뷰 4차) — 비게스트 인증
        //    상태의 계정 전환에서 (버려질) 현재 유저까지 잠그면 users 2행(현재+대상) 잠금이 되어
        //    역방향 전환 2건이 교착한다. 게스트 한정이면 어떤 로그인도 users 1행만 잠근다
        //    (승격 = 본인 행, 전환 = 대상 행) — 논증은 findActiveGuestByIdForUpdate 주석 참고.
        User guestUser = currentUserId == null ? null
                : userRepository.findActiveGuestByIdForUpdate(currentUserId).orElse(null);

        // 선택 AT 세션 관문 ① (GROMO-1929) — 게스트 호출자는 본인 users 배타 락을 방금 쥐었으므로
        // canonical users → session 순서로, 도메인 분기(ALREADY_LINKED)·mutation 보다 먼저 연다.
        // 폐기·세대 불일치 세션은 어떤 분기보다 먼저 401 이다 (승인 정책).
        if (guestUser != null) {
            checkCallerSessionActive(guestUser, callerSessionId, callerAuthGeneration);
        }

        boolean isNewUser;
        User user;

        if (socialAccount.isPresent()) {
            if (guestUser != null) {
                // 게스트가 이미 다른 계정에 연동된 소셜로 업그레이드 시도 → 거부(게스트 유지)
                throw new AuthException(AuthErrorCode.SOCIAL_ACCOUNT_ALREADY_LINKED);
            }
            // 승격 패자 가드를 이 분기에는 **걸지 않는다** (결정 D17·D18, 리뷰 5라운드 결론).
            // "승격된 게스트 클레임 + 선재 타 계정" 상태는 ① 진짜 동시 승격 레이스의 패자와
            // ② 오래됐지만 유효한 게스트 AT 로 예전부터 있던 다른 자기 계정에 재로그인하는 정당한
            // 요청이 서버 관점에서 구분 불가능하고(시간 신호 시도는 대상 계정의 createdAt 이 레이스와
            // 무인과라 실패 — claude 리뷰), 이 분기의 통과 결말은 호출자가 소셜 토큰 검증으로 소유를
            // 증명한 계정 로그인이라 유령 계정이 아니다(게스트 데이터도 승격 계정에 무손실). 차단은
            // 더 흔한 정당 케이스를 깨뜨리므로 fail-open — 유령 방지는 아래 폴백 분기 가드가 맡는다.
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
            // 선택 AT 세션 관문 ② (GROMO-1929) — 비게스트 호출자의 신규 가입 폴백. 대상 계정이
            // 아직 없어(새 행이라 선점 락이 없다) 호출자 users 행을 잠궈도 users 2행 잠금이 되지
            // 않는 유일한 경로라, canonical users → session 순서로 패자 판별·save 보다 먼저 연다.
            // getCallerForUpdate 가 탈퇴·부재 주체를 404 로 걸러 폐기 판정보다 계정 부재가 먼저다.
            if (currentUserId != null) {
                checkCallerSessionActive(userQueryService.getCallerForUpdate(currentUserId),
                        callerSessionId, callerAuthGeneration);
            }
            // 동시 다른-소셜 승격 경쟁의 패자 차단 (GROMO-1229, D3) — 이대로 신규 가입 폴백을 타면
            // 닉네임 null 의 빈 유령 계정이 조용히 생긴다. 판별 논증은 isConcurrentlyPromotedGuest 참고.
            if (isConcurrentlyPromotedGuest(currentUserId, callerGuestClaim)) {
                // 같은 소셜 동시 승격의 패자는 에러가 아니다 (codex R1) — 메서드 첫 조회 때는 승자의
                // 커밋 전이라 socialAccount 가 비었지만, 게스트 락 대기를 지나온 지금은 같은
                // (provider, providerId) 가 승자 손에 붙어 있을 수 있다. 재조회해서 **승격된 본인
                // 계정에 붙어 있으면** 그 계정으로 정상 로그인 — 종전 유니크 위반 → DIVE 재시도가
                // 만들던 자가치유와 같은 결말이다. 소유자 검증(codex R2): 재조회가 찾은 계정이 다른
                // 유저 소유면(다른-소셜 패자 + 제3의 요청이 같은 소셜을 다른 계정에 선점) 자가치유가
                // 아니라 조용한 계정 이동이 된다 — 게스트 데이터가 어디로 승격됐는지 숨긴 채 다른
                // 계정에 앉히므로, 그 경우도 409 로 알리고 다음 로그인이 정식 present 분기를 타게 한다.
                //
                // fail-closed 비대칭 (D17·D18·D20) — 이 분기는 모호성에 닫는다: 무관한 제3의 요청이
                // 같은 (provider, providerId)를 다른 계정에 선점한 경우와 진짜 레이스 패자가 서버
                // 관점에서 구분 불가능해 둘 다 409 로 묶는다(드문 정당 로그인이 차단되는 비용 수용).
                // present 분기(위 fail-open 서술)와는 의도된 비대칭이다 — 무가드 대안의 비용이 다르다:
                // 여기선 닉네임 null 의 유령 계정이 생기고, 저기선 소셜 토큰으로 소유가 증명된 로그인이
                // 통과할 뿐이다. fail-open 논증 자체는 present 분기 주석이 정본 — 여기 중복하지 않는다.
                user = socialAccountRepository
                        .findByProviderAndProviderId(provider, providerId)
                        .filter(account -> account.getUser().getId().equals(currentUserId))
                        .map(SocialAccount::getUser)
                        .orElseThrow(() -> new AuthException(AuthErrorCode.GUEST_ALREADY_PROMOTED));
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
        }

        // 탈퇴 직렬화 (GROMO-801, codex 리뷰) — 기존 소셜 유저 분기는 유저를 락 없이 로드하므로,
        // 조회와 토큰 발급 사이에 탈퇴(유저 행 배타 락)가 커밋되면 아래 refreshTokenHash 세팅의
        // full-row UPDATE 가 stale User 로 is_deleted=false·구 PII 를 되살리고 발급된 토큰이 유효하게
        // 남는다. 토큰 상태를 바꾸기 전에 같은 행을 잠가 직렬화한다 — 탈퇴가 먼저 커밋됐으면 여기서
        // 삭제를 관측하고 기존 탈퇴 유저 차단 계약대로 NOT_FOUND 로 거절된다(재로그인 시 소셜 연동
        // 행이 이미 지워져 있어 정상적인 신규 가입 흐름을 탄다).
        // 배타 락인 이유(codex 리뷰 3차와 같은 패턴 선제 적용): 이 트랜잭션은 곧 users 행을
        // UPDATE 하므로, 공유 락이면 같은 계정의 동시 로그인 2건이 둘 다 FOR SHARE 를 쥔 채 승급을
        // 기다리며 교착한다. 게스트 승격·신규 가입 분기는 위에서 이미 배타 락을 쥐었거나 이
        // 트랜잭션이 방금 만든 행이라, 같은 행 재조회일 뿐 동작이 달라지지 않는다.
        user = userQueryService.getCallerForUpdate(user.getId());

        // 선택 AT 세션 관문 ③ (GROMO-1929) — 비게스트 호출자의 기존 계정 전환(present 분기)은
        // 대상 users 락 뒤에 연다. 호출자 행을 추가로 잠그면 (호출자+대상) users 2행 잠금이 되어
        // 역방향 전환 교착이라 잠그지 않는다 — session 잠금은 단말이라 users(대상) → session(호출자)
        // 순도 사이클이 없고, 폐기 직렬화는 verifySession 의 세션 행 배타 락(커밋까지 유지)이 담당한다.
        // 호출자가 대상 본인이면 방금 잠근 그 행이다. (① 게스트·② 신규 폴백 호출자는 이미 관문 통과)
        if (currentUserId != null && guestUser == null && socialAccount.isPresent()) {
            User callerRow = user.getId().equals(currentUserId) ? user
                    : userQueryService.getCaller(currentUserId);
            checkCallerSessionActive(callerRow, callerSessionId, callerAuthGeneration);
        }

        // 소프트딜리트된 연동 → deletedAt = null 로 복원(재활성화). unique 제약 충돌 방지.
        // 관문 뒤에 둔다 — 거절 경로에 어떤 상태 변경도 남기지 않기 위해 (GROMO-1929).
        if (socialAccount.isPresent() && socialAccount.get().getDeletedAt() != null) {
            socialAccount.get().setDeletedAt(null);
        }

        String refreshToken = jwtProvider.generateRefreshToken(user.getId(), user.isGuest());
        // RT 원본은 응답으로만 내려가고 DB 에는 해시만 남긴다 — DB 유출 시 재사용 차단 (GROMO-713)
        user.setRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));
        // 세션 축을 «같은 트랜잭션에서» 연다(㋣). 따로 커밋하면 「RT 는 살아 있는데 세션 행은 없는」
        // 구간이 생기고, 그 구간의 로그아웃은 끊을 대상을 못 찾는다.
        AuthSessionService.IssuedSession session = authSessionService.open(user.getId(), refreshToken);
        // guest 클레임은 발급 시점 상태 (GROMO-1229) — 승격 직후·소셜 로그인은 isGuest=false 라 비게스트 토큰이 나간다.
        // gen·sid 는 additive claim 이다(㊽ · ㋞) — 앱이 로그인과 무관한 시점에 기기 토큰을 등록하므로
        // 로그인 응답만으로는 세대를 전달할 수 없다.
        String accessToken = jwtProvider.generateAccessToken(
                user.getId(), user.isGuest(), user.getAuthGeneration(), session.sessionId());

        // 신규 유저만 가입 이벤트 발행 — 재활성화 로그인·게스트 업그레이드(isNewUser=false)는 제외
        if (isNewUser) {
            userActivityEventLogger.log(user.getId().toString(), UserActivityEvent.USER_SIGNED_UP,
                    Map.of("method", provider.name().toLowerCase(), "is_guest", false));
        }
        userActivityEventLogger.log(user.getId().toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", isNewUser, "method", provider.name().toLowerCase()));

        return new SocialLoginResponse(
                accessToken, refreshToken, isNewUser, session.deviceBootstrap(), session.sessionId());
    }

    /**
     * 동시 승격 경쟁의 <b>패자</b>인가 (GROMO-1229) — 게스트로 발급된 AT(guest 클레임 true)로 왔는데
     * 그 유저가 이미 활성 <b>비게스트</b>다 = 다른 요청이 방금 이 게스트를 승격 커밋했다. 정식
     * "계정 전환"(비게스트 AT)은 클레임이 false/null 이라 걸리지 않는다 — DB 상태만으로는 두 경우가
     * 동일해서 발급 시점 클레임이 유일한 판별 신호다. 호출 전제: 게스트 락 조회가 빈 뒤(= guestUser
     * null)에만 부른다. 판별 조회는 <b>무락</b> — 현재 유저 행까지 잠그면 users 2행 잠금이 되어
     * 게스트 한정 락의 교착 방지 논증(findActiveGuestByIdForUpdate 주석, codex 리뷰 4차)이 깨진다.
     * 유저가 없거나 탈퇴면 false — 탈퇴 게스트의 유효 토큰 → 신규 가입 폴백은 의도된 동작.
     */
    private boolean isConcurrentlyPromotedGuest(UUID currentUserId, Boolean callerGuestClaim) {
        return Boolean.TRUE.equals(callerGuestClaim) && currentUserId != null
                && userQueryService.findActive(currentUserId)
                        .filter(caller -> !caller.isGuest())
                        .isPresent();
    }


    /**
     * 이 소셜 계정이 <b>호출자가 아닌 다른 사용자</b> 에게 이미 붙어 있는가 (GROMO-1994).
     *
     * <p>{@link #loginOrRegister} 의 {@code socialAccount.isPresent() && guestUser != null} 분기가
     * 409 {@code SOCIAL_ACCOUNT_ALREADY_LINKED} 를 던지는 바로 그 조건을, 트랜잭션·잠금 없이 먼저
     * 물어보는 read 다. 「확인 후 전환」의 2단계 중 <b>2단계가 정말 전환인지</b> 를 파기(게스트 탈퇴)
     * 전에 확정해야 하기 때문이다 — 충돌이 아닌데 전환으로 처리하면 게스트 데이터를 버리고 빈 신규
     * 계정을 만든다.
     *
     * <p>소프트 해제된 연동도 <b>붙어 있는 것으로 센다</b> — {@code loginOrRegister} 가 같은 행을
     * {@code deletedAt = null} 로 되살려 그 계정에 로그인시키므로, 여기서만 없는 셈 치면 두 판정이
     * 어긋난다.
     *
     * <p>무락 사전 조회이므로 <b>인가 결과가 아니다</b>(계정 LLD §3 「무락 사전 조회는 잠글 ID
     * 발견용이고 인가 결과로 사용하지 않는다」). 실제 분기는 잠금을 쥔 {@code loginOrRegister} 가 다시 한다.
     *
     * @param callerUserId 선택 AT 의 주체. {@code null} 이면 「다른 사용자」 비교 대상이 없다
     */
    public boolean isLinkedToAnotherUser(Provider provider, String providerId, UUID callerUserId) {
        return socialAccountRepository.findByProviderAndProviderId(provider, providerId)
                .map(account -> account.getUser().getId())
                .filter(ownerId -> !ownerId.equals(callerUserId))
                .isPresent();
    }

    /**
     * 게스트 가입 — 소셜 연동 없이 User 를 만들고 부속 4행까지 함께 만든다.
     *
     * @return 발급된 AT·RT. 게스트 여부는 항상 {@code true}
     */
    @Transactional
    public GuestLoginResponse guestLogin() {
        IssuedGuest issued = createGuest();
        return new GuestLoginResponse(issued.accessToken(), issued.refreshToken(), issued.user().isGuest(),
                issued.session().deviceBootstrap(), issued.session().sessionId());
    }

    /**
     * 2.0 공개 표면의 게스트 세션 발급 — <b>같은 기기 digest 의 재시도는 계정을 하나 더 만들지 않는다</b>
     * (GROMO-2036 · {@link GuestDeviceClaim}).
     *
     * <h2>왜 트랜잭션 «밖» 인가</h2>
     * 같은 기기의 동시 최초 발급에서 판정자는 점유 원장의 PK 유니크다. 진 쪽은 제약 위반으로
     * 트랜잭션이 통째로 롤백되고(= 자기가 만들던 게스트 유저도 함께 사라져 고아 계정이 남지 않는다)
     * <b>새 트랜잭션에서</b> 다시 조회해 이긴 쪽의 유저를 받는다. 재시도를 트랜잭션 안에 두면 이미
     * 롤백 표시된 트랜잭션에서 읽게 되어 아무것도 보이지 않는다 — {@code loginOrRegister} 의
     * 첫 로그인 유니크 위반 재시도와 같은 구조다.
     *
     * <p>{@code NOT_SUPPORTED} 가 <b>반드시</b> 필요하다. 클래스 기본이
     * {@code @Transactional(readOnly = true)} 라 이 메서드가 읽기 전용 트랜잭션을 열고, 그러면 아래
     * {@code REQUIRED} 호출이 <b>그 트랜잭션에 합류하면서 readOnly 를 물려받는다</b> — 세션 발급의
     * {@code SELECT … FOR NO KEY UPDATE} 가 「read-only 트랜잭션에서 실행할 수 없다」로 터진다.
     * {@code socialLogin} 이 같은 이유로 같은 전파를 쓴다.
     *
     * @param deviceDigest Business 가 자기 비밀로 계산한 기기 식별자의 keyed HMAC. 원문은 오지 않는다
     * @return 발급된 세션. 창 안의 재시도면 <b>같은 userId</b> 의 새 세션이다
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public LoginSessionResult guestSession(String deviceDigest) {
        try {
            return self.guestSessionInTransaction(deviceDigest);
        } catch (DataIntegrityViolationException e) {
            // 같은 기기의 동시 최초 발급에서 진 쪽. 이제 이긴 점유가 보이므로 그 유저로 이어 붙는다.
            return self.guestSessionInTransaction(deviceDigest);
        }
    }

    /**
     * 점유 조회 → (창 안이면) 같은 유저의 새 세션 / (아니면) 새 게스트 + 점유 확정.
     *
     * <p>만료된 점유는 <b>여기서 지우고 다시 쓴다</b>. 별도 청소 배치를 두지 않은 이유는
     * V87 주석 ④ 에 있다.
     */
    @Transactional
    public LoginSessionResult guestSessionInTransaction(String deviceDigest) {
        Instant now = clock.instant();
        GuestDeviceClaim claim = guestDeviceClaimRepository.findById(deviceDigest).orElse(null);
        if (claim != null) {
            // 점유가 살아 있어도 그 유저가 «지금도 활성 게스트» 여야 한다. 탈퇴했거나 소셜로 승격됐으면
            // 그 계정에 게스트 자격으로 새 세션을 열어 주면 안 된다 — 점유를 버리고 새로 만든다.
            User owner = claim.isRecoverableAt(now)
                    ? userRepository.findActiveGuestByIdForUpdate(claim.getUserId()).orElse(null)
                    : null;
            if (owner != null) {
                userActivityEventLogger.log(owner.getId().toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                        Map.of("is_new_user", false, "method", "guest"));
                return resultOf(owner, openGuestSession(owner));
            }
            // 같은 PK 로 다시 INSERT 하므로 삭제를 먼저 flush 한다 — 순서가 뒤집히면 자기 자신과 충돌한다.
            guestDeviceClaimRepository.delete(claim);
            guestDeviceClaimRepository.flush();
        }

        IssuedGuest issued = createGuest();
        guestDeviceClaimRepository.save(new GuestDeviceClaim(
                deviceDigest, issued.user().getId(), now, now.plus(GUEST_DEVICE_RECOVERY_WINDOW)));
        return resultOf(issued.user(), issued);
    }

    /** 게스트 유저 한 명 + 부속 4행 + 첫 세션. {@code guestLogin} 과 2.0 게스트 발급이 함께 쓴다. */
    private IssuedGuest createGuest() {
        User newUser = userRepository.save(User.builder().isGuest(true).build());
        createUserSideRows(newUser.getId());
        IssuedGuest issued = openGuestSession(newUser);

        // 게스트 생성은 항상 신규 가입
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "guest", "is_guest", true));
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "guest"));
        return issued;
    }

    /**
     * 게스트 유저 하나에 <b>새 로그인 세션</b>을 연다.
     *
     * <p>유저 축 단일 해시도 함께 갈아끼운다 — 이 발급이 그 기기의 마지막 로그인이기 때문이다.
     * 앞선 세션 행은 살아 있고, 그 RT 는 세션 행이 권위인 갱신 경로로 계속 유효하다(A22 ㋣).
     */
    private IssuedGuest openGuestSession(User user) {
        String refreshToken = jwtProvider.generateRefreshToken(user.getId(), user.isGuest());
        user.setRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));
        AuthSessionService.IssuedSession session = authSessionService.open(user.getId(), refreshToken);
        // 게스트 발급 경로 — guest=true 클레임을 실어, 승격 후 이 토큰으로 오는 요청을 판별한다 (GROMO-1229)
        String accessToken = jwtProvider.generateAccessToken(
                user.getId(), user.isGuest(), user.getAuthGeneration(), session.sessionId());
        return new IssuedGuest(user, accessToken, refreshToken, session);
    }

    private LoginSessionResult resultOf(User user, IssuedGuest issued) {
        return new LoginSessionResult(issued.accessToken(), issued.refreshToken(), user.getId(),
                OnboardingCompletion.isComplete(user));
    }

    /** 발급 한 건의 재료 — 호출부마다 다른 응답 모양으로 조립한다. */
    private record IssuedGuest(User user, String accessToken, String refreshToken,
                               AuthSessionService.IssuedSession session) {
    }

    /**
     * 2.0 공개 로그인 결과 네 필드 — 소셜 로그인의 {@code LoginSessionResponse} 와 같은 모양이다.
     *
     * <p>{@code deviceBootstrap}·{@code sessionId} 를 담지 않는다. 그 둘은 기기 등록 축의 자격이고,
     * 공개 게스트 발급 계약에는 들어 있지 않다(계정 LLD §2.1 「본문 4필드는 유지한다」).
     */
    public record LoginSessionResult(String accessToken, String refreshToken, UUID userId,
                                     boolean onboardingComplete) {

        @Override
        public String toString() {
            return "LoginSessionResult[userId=" + userId + ", tokens=redacted]";
        }
    }

    /**
     * AT 재발급. RT 는 만료가 임박하면 함께 회전한다.
     *
     * <h2>세션 원장을 «먼저» 본다 (A22 ㋣ · codex R10 P1)</h2>
     * {@code users.refresh_token_hash} 는 유저당 <b>하나</b>다. 같은 유저가 B 기기에서 다시 로그인하면
     * 로그인 경로가 그 값을 B 의 해시로 덮는데, A 기기의 {@code auth_sessions} 행은 <b>여전히 활성</b>
     * 이다. 종전 코드는 유저 해시 조회를 먼저 해서 A 의 갱신이 세션 조회에 닿기도 전에 401 이 됐고,
     * 결국 A 는 AT 만료와 함께 강제 로그아웃됐다 — 세션을 여러 개 둔다는 계약이 유저 행 한 줄에
     * 막혀 있었던 것이다. 그래서 <b>세션 행이 있으면 그 행이 판정·회전의 권위</b>이고, 유저 해시
     * 검사는 <b>세션 행이 없는 구 RT</b> 에만 쓴다(㋪).
     *
     * <h2>왜 users 행을 «먼저» 배타 락으로 잡는가</h2>
     * 회전이 건드리는 행은 셋이다 — {@code users}(단일 해시) · {@code aggregate_versions}(fencing 값
     * 발급) · {@code auth_sessions}(세션). 로그아웃·탈퇴·로그인도 같은 셋을 건드리므로 순서가 갈리면
     * 교착이다. <b>조건부 UPDATE 는 락이 아니다</b>: 술어가 안 맞으면 Postgres 는 그 행을 잠그지
     * 않는다 — 즉 「B 가 단일 해시를 가져간 뒤의 A 회전」은 {@code users} 를 <b>전혀</b> 잠그지 않은
     * 채 aggregate·session 을 잡으러 가고, 그때 {@code users} 를 쥔 로그아웃이 session 을 기다리면
     * 사이클이 된다.
     *
     * <p>그래서 이 트랜잭션도 {@code users} 행 배타 락을 <b>가장 먼저</b> 잡는다. auth 축을 건드리는
     * 네 경로(로그인·갱신·로그아웃·탈퇴)가 전부 같은 유저 행을 선두에서 잡으므로, 같은 유저에 대한
     * 두 경로는 aggregate·session 근처에 <b>동시에 존재할 수 없다</b>. 회전 판정도 그 락 아래의
     * 신선한 스냅샷으로 한다 — 세션 조회를 락 대신 쓰면 「로그아웃이 방금 끊은 세션」으로 AT 를
     * 발급하는 창이 남는다.
     *
     * @param refreshToken 자체 발급 RT. {@code type} 이 refresh 가 아니면(access·구 토큰) 거절한다(GROMO-714)
     * @return 새 AT 와, 회전이 일어났으면 새 RT
     */
    @Transactional
    public TokenRefreshResponse refreshToken(String refreshToken) {
        return refresh(refreshToken, true);
    }

    /**
     * 2.0 공개 표면의 AT 재발급 — <b>회전하지 않고, sid 없는 구 RT 도 받지 않는다</b> (GROMO-2035).
     *
     * <h2>왜 회전을 끄는가</h2>
     * 계정 LLD §3 「정상 RT 회전의 클라이언트 전환 gate」: 「서버는 원자 credential bundle/journal과
     * 모든 인증 reader·writer의 전환이 검증되지 않은 클라이언트에는 <b>정상 RT 회전을 활성화하지
     * 않는다</b>. 해당 호환 경로는 기존 유효 RT의 서명·만료·현재 해시를 검증한 뒤 미회전 응답
     * {@code refreshToken:null} 을 사용한다.」 2.0 앱은 아직 그 gate 를 통과하지 않았다 — 회전 응답이
     * 유실되면 앱은 새 RT 를 모르는데 구 RT 는 이미 죽어, 그 기기가 통째로 로그아웃된다.
     *
     * <h2>왜 legacy 승격을 막는가</h2>
     * {@code refreshLegacy} 는 <b>언제나</b> 회전하고(세션 축에 올리는 유일한 자리라서) 그 결과가
     * 유실됐을 때 복원할 승격 전용 receipt 가 아직 없다(LLD §3 「legacy RT 승격 전용 결과 복구」 —
     * 「main에는 승격 전용 receipt가 없다」). 2.0 앱의 RT 는 전부 {@code POST /auth/sessions} ·
     * 게스트 발급이 만든 <b>세션 있는</b> 토큰이라 이 분기에 정상적으로 닿지 않는다. 그래서 닿으면
     * 거절한다 — 복구 불가능한 승격을 새 표면에서 열지 않는다.
     *
     * <p>이미 회전돼 죽은 RT·위조·만료도 모두 여기서 401 {@code REFRESH_TOKEN} 이다: 죽은 RT 는
     * 세션 조회가 비고, 위조·만료는 위 타입·서명 가드에서 걸린다.
     *
     * @param refreshToken 세션 있는 RT 원문
     * @return 새 AT 와 {@code refreshToken=null}
     */
    @Transactional
    public TokenRefreshResponse refreshSessionAccessToken(String refreshToken) {
        return refresh(refreshToken, false);
    }

    /**
     * @param legacyCompatible 1.x {@code /api/v1/auth/refresh} 의 동작 — 회전과 sid 없는 구 RT 승격을
     *                         허용한다. 2.0 표면은 {@code false} 다
     */
    private TokenRefreshResponse refresh(String refreshToken, boolean legacyCompatible) {
        // refresh 타입만 허용 (GROMO-714) — access·구 토큰(type 없음 = null)은 거부한다.
        // 가드가 try 안에 있어야 extractType 이 만료·서명오류에 던지는 JwtException 도 401 로 변환된다
        // (InvalidTokenException 은 RuntimeException 이라 아래 catch 에 걸리지 않는다).
        // 만료 시각도 여기서 함께 읽는다 — 아래 회전 판정이 토큰을 다시 파싱하면 그 사이 만료된
        // 토큰이 401 이 아니라 500 으로 새는 창이 생긴다.
        UUID tokenUserId;
        Date refreshExpiresAt;
        try {
            if (!JwtProvider.TYPE_REFRESH.equals(jwtProvider.extractType(refreshToken))) {
                throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
            }
            tokenUserId = jwtProvider.extractUserId(refreshToken);
            refreshExpiresAt = jwtProvider.extractExpiration(refreshToken);

        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        // 락을 «맨 앞»에 — 위 javadoc 의 락 순서 논증이다. 서명된 RT 가 지목한 유저이므로 이 락은
        // 조회 결과가 아니라 토큰에서 곧장 나온다. 빈 값 = 없는 유저 or 탈퇴가 먼저 커밋됐다.
        User user = userRepository.findActiveByIdForUpdate(tokenUserId)
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));

        // 세션 조회는 락 «뒤»다 — 앞에 두면 로그아웃이 그 사이 커밋한 폐기를 못 본다.
        Optional<AuthSession> existingSession = authSessionService.findByRefreshToken(refreshToken);
        if (existingSession.isPresent()) {
            return refreshOnSession(existingSession.get(), user, refreshToken, refreshExpiresAt, legacyCompatible);
        }
        if (!legacyCompatible) {
            // 2.0 표면에는 sid 없는 구 RT 승격이 없다 — 위 refreshSessionAccessToken javadoc 참고.
            // 이미 회전돼 죽은 세션 RT 도 세션 조회가 비어 여기로 떨어지고, 답은 같은 401 이다.
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }
        return refreshLegacy(user, refreshToken);
    }

    /**
     * 세션 행이 있는 RT 의 갱신 — 이 축이 판정·회전의 권위다 (A22 ㋣).
     *
     * <p>전제: 호출부가 {@code users} 행 배타 락을 쥐고 있고, 세션은 그 <b>락 아래에서</b> 조회됐다.
     *
     * @param session          그 RT 를 인정하는 세션 행
     * @param user             락 아래에서 읽은 활성 유저 — RT 가 서명으로 지목한 그 유저다
     * @param refreshToken     제시된 RT 원문
     * @param refreshExpiresAt 그 RT 의 만료 시각 — 회전 판정 입력
     * @param rotationAllowed  {@code false} 면 회전 시점이어도 회전하지 않는다 (GROMO-2035 · 계정 LLD §3
     *                         「정상 RT 회전의 클라이언트 전환 gate」)
     * @return 새 AT 와, 회전이 일어났으면 새 RT
     */
    private TokenRefreshResponse refreshOnSession(AuthSession session, User user, String refreshToken,
                                                  Date refreshExpiresAt, boolean rotationAllowed) {
        // 남의 세션 행을 자기 RT 로 집어가지 못하게 서명된 소유자와 대조한다 — logout 과 같은 가드다.
        // 폐기된 세션은 되살리지 않는다(락 아래 조회라 「방금 커밋된 로그아웃」도 여기서 보인다).
        if (!session.getUserId().equals(user.getId()) || !session.isActive()) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        // refresh 회전 (GROMO-1509) — 종전에는 refresh 를 재발급하지 않아 수명이 **로그인 시점부터
        // 고정**이었다. 매일 쓰는 유저도 만료일이 오면 그대로 로그아웃됐고, 게스트에겐 그게 곧 계정
        // 소실이다(guestLogin 은 언제나 새 User 를 만든다). 남은 수명이 절반 밑으로 떨어지면
        // 갈아끼워, 계속 쓰는 한 세션이 끊기지 않게 한다. 회전 안 하는 갱신은 refreshToken=null 로
        // 응답하고 클라이언트는 저장소를 건드리지 않는다.
        if (!rotationAllowed || !jwtProvider.isRefreshRotationDue(refreshExpiresAt, user.isGuest())) {
            // 회전하지 않아도 AT 는 새로 나간다 — 그 AT 의 sid 는 «지금 쥔 RT 의 세션»이다.
            return new TokenRefreshResponse(
                    issueAccessToken(user, session.getId()), null, session.getId(), null);
        }

        String currentHash = TokenHasher.sha256Hex(refreshToken);
        String rotatedRefreshToken = jwtProvider.generateRefreshToken(user.getId(), user.isGuest());
        // 유저 축 단일 해시는 «아직 이 RT 를 가리킬 때만» 따라 움직인다.
        //   · 가리키고 있으면(=이 기기가 마지막 로그인) 반드시 갈아끼운다. 안 그러면 회전으로 죽은 RT 가
        //     유저 행에 남아, 세션 행이 회전된 뒤 구 RT 승격 경로로 «되살아난다».
        //   · 다른 기기가 가져갔으면 «건드리지 않는다». 덮으면 B 기기의 구 RT 경로가 끊긴다.
        // 판정을 락 아래 스냅샷으로 먼저 하고, 쓰기는 조건부 UPDATE 로 좁게 낸다(full-row UPDATE 가
        // 탈퇴가 세운 is_deleted·파기된 PII 를 되살리지 않게 — UserRepository 주석 참고).
        // 락을 쥔 채이므로 여기서 0 행이 나오면 그것은 경합이 아니라 «불변식 위반»이다 → fail-closed.
        if (currentHash.equals(user.getRefreshTokenHash())) {
            int rotated = userRepository.rotateRefreshTokenHash(
                    user.getId(), currentHash, TokenHasher.sha256Hex(rotatedRefreshToken));
            if (rotated == 0) {
                throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
            }
        }
        // 세션 행 CAS. users 락이 같은 유저의 동시 회전을 이미 직렬화하므로 여기서 0 이 나올 수는
        // 없지만, 락 규율이 깨지는 날 조용히 덮어쓰는 대신 끊기도록 fail-closed 로 남겨 둔다.
        AuthSessionService.IssuedSession rotated = authSessionService
                .rotateActive(session, refreshToken, rotatedRefreshToken)
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));
        return new TokenRefreshResponse(issueAccessToken(user, rotated.sessionId()), rotatedRefreshToken,
                rotated.sessionId(), rotated.deviceBootstrap());
    }

    /**
     * 세션 행이 없는 구 RT 의 갱신 — 유저 행의 단일 해시가 유일한 판정 근거다 (㋪).
     *
     * <p>남은 수명과 관계없이 <b>항상 회전</b>한다. 그 회전이 세션 축에 올리는 유일한 자리라,
     * 여기서 건너뛰면 구 토큰을 든 기기가 끝까지 세션 없이 남는다.
     *
     * <p>이미 회전된 RT 가 여기로 떨어져도 <b>되살아나지 않는다</b> — 회전이 유저 해시를 새 값으로
     * 갈아끼웠거나(이 기기가 마지막 로그인), 애초에 다른 기기가 그 자리를 갖고 있어 어느 쪽이든
     * 아래 해시 대조가 어긋난다.
     *
     * @param user         락 아래에서 읽은 활성 유저 — RT 가 서명으로 지목한 그 유저다
     * @param refreshToken 제시된 구 RT 원문
     * @return 새 AT·새 RT 와 승격된 세션 값
     */
    private TokenRefreshResponse refreshLegacy(User user, String refreshToken) {
        // 대조도 해시로 — 저장과 같은 변환을 거쳐야 매칭된다 (GROMO-713)
        String currentHash = TokenHasher.sha256Hex(refreshToken);
        if (!currentHash.equals(user.getRefreshTokenHash())) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        String rotatedRefreshToken = jwtProvider.generateRefreshToken(user.getId(), user.isGuest());
        int rotated = userRepository.rotateRefreshTokenHash(
                user.getId(), currentHash, TokenHasher.sha256Hex(rotatedRefreshToken));
        if (rotated == 0) {
            // 락을 쥐고 대조까지 통과한 뒤라 여기까지 오면 불변식이 깨진 것이다 — 끊긴 세션은
            // 되살리지 않는다는 계약대로 거절한다(fail-closed).
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }
        // 세션 행이 여기서 승격(백필)된다(㋪) — 구 RT 는 sessionId 가 없어서, 첫 회전이 세션 축에
        // 올리는 유일한 자리다.
        AuthSessionService.IssuedSession session =
                authSessionService.promoteLegacy(user.getId(), rotatedRefreshToken, user.getDeviceToken());
        return new TokenRefreshResponse(issueAccessToken(user, session.sessionId()), rotatedRefreshToken,
                session.sessionId(), session.deviceBootstrap());
    }

    /**
     * 재발급 AT — 재발급 시점 유저 상태로 만든다 (GROMO-1229: 게스트가 승격하면 guest=false).
     *
     * <p>{@code gen}·{@code sid} 는 additive claim 이다. <b>세대는 DB 의 현재 값</b>이고, 이 값이
     * 옛 AT 에 소급되지 않는 것이 계약이다(㊍) — 옛 AT 는 claim 이 없는 채로 만료까지 남는다.
     */
    private String issueAccessToken(User user, UUID sessionId) {
        return jwtProvider.generateAccessToken(
                user.getId(), user.isGuest(), user.getAuthGeneration(), sessionId);
    }

    /**
     * 로그아웃 — 저장된 RT 해시를 지우고 <b>그 세션만</b> 끊는다.
     *
     * <p>명시한 기기 토큰 또는 구 RT에 연결한 이관 기기의 삭제를 <b>같은 트랜잭션에서</b> 남긴다(㋗ · ㊲).
     * 앱은 토큰 {@code DELETE} 를 AT 로 인증해 별개 요청으로 보내는데, 로그아웃 직전에는 그 AT 가
     * 이미 만료돼 401 이 되는 일이 흔하다 — 그러면 앱은 실패를 삼키고 로컬 인증을 지우므로
     * <b>아무도 재시도하지 않고 이전 계정 푸시가 그 기기로 계속 간다</b>.
     *
     * <p><b>유저 축 세대는 올리지 않는다</b>(㊼) — 올리면 로그인 중인 다른 기기의 재등록이 거부된다.
     *
     * @param request RT 와(선택) 대상 기기 토큰·소유권 값·멱등 키. access 토큰을 보내면 타입 가드에
     *                걸려 거절된다(GROMO-714)
     */
    @Transactional
    public void logout(LogoutRequest request) {
        String refreshToken = request.refreshToken();
        UUID tokenUserId;
        // refreshToken() 과 동일한 refresh 타입 가드 — access 토큰으로 세션을 끊지 못하게 한다 (GROMO-714).
        try {
            if (!JwtProvider.TYPE_REFRESH.equals(jwtProvider.extractType(refreshToken))) {
                throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
            }
            tokenUserId = jwtProvider.extractUserId(refreshToken);
        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        // users → session 순서로 잠근다. 같은 RT 응답 유실 재시도와 동시 로그아웃은 하나로 수렴한다.
        User user = userRepository.findActiveByIdForUpdate(tokenUserId).orElse(null);
        Optional<AuthSession> session = authSessionService.findByRefreshToken(refreshToken);
        if (session.isPresent() && !session.get().getUserId().equals(tokenUserId)) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }
        if (session.isPresent() && !session.get().isActive()) {
            return; // 첫 요청의 삭제 명령·세션 폐기가 같은 커밋에 남아 있다.
        }
        String hash = TokenHasher.sha256Hex(refreshToken);
        if (user == null || (session.isEmpty() && !hash.equals(user.getRefreshTokenHash()))) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }
        String legacyDeviceToken = session.isEmpty() ? user.getDeviceToken()
                : (session.get().isLegacy() ? session.get().getLegacyDeviceToken() : null);
        if (session.isEmpty()) {
            authSessionService.recordLegacyLogoutSession(user.getId(), refreshToken, legacyDeviceToken);
        }
        // A 기기의 지연 로그아웃이 B 기기의 최신 RT 를 지우지 않는다.
        if (hash.equals(user.getRefreshTokenHash())) {
            user.setRefreshTokenHash(null);
        }
        // 명시한 대상이 없으면 검증된 구 RT에 연결해 둔 기기만 삭제한다.
        // 현재 users 토큰으로 다른 세션의 기기를 추정하지 않고, 재등록된 바인딩도 보존한다.
        if (request.deviceToken() != null && !request.deviceToken().isBlank()) {
            userSatelliteCommandService.recordDeviceTokenDeletion(
                    user.getId(),
                    new DeviceTokenDeletionRequest(
                            request.deviceToken(), request.ownershipToken(), null),
                    logoutIdempotencyKey(request));
        } else if (legacyDeviceToken != null && !legacyDeviceToken.isBlank()) {
            userSatelliteCommandService.recordLegacyLogoutDeviceTokenDeletion(
                    user.getId(), legacyDeviceToken, logoutIdempotencyKey(request));
        }
        // 개별 기기 로그아웃 = «세션»이 끝나는 사건이다(㋞). 유저 축 세대는 올리지 않는다 —
        // 올리면 로그인 중인 다른 기기의 재등록이 거부돼 그 기기 푸시가 끊긴다(㊼).
        // 폐기 사실은 같은 트랜잭션의 outbox 로 알림 서버에 전달된다(비동기 폐기만으로는 relay 지연
        // 사이에 도착한 지연 등록이 «미사용 1회용 자격»으로 통과한다, ㋤).
        authSessionService.revokeByRefreshToken(refreshToken);

        userActivityEventLogger.log(UserActivityEvent.LOGOUT, Map.of());
    }

    /**
     * 로그아웃의 멱등 키 — 앱이 주면 그 값, 아니면 <b>이 RT·이 토큰에 고정된</b> 값을 만든다.
     *
     * <p>본문에서 키를 도출하는 것이 여기서는 안전하다. ㊞ 가 금지하는 것은 <b>생성</b> 명령의 본문
     * 유래 키다 — 「끝난 챌린지를 같은 설정으로 다시 만드는」 정상 명령이 과거 응답으로 접히기
     * 때문이다. 기기 토큰 삭제는 같은 대상을 두 번 지워도 결과가 같으므로 접히는 편이 맞다.
     *
     * <p>RT 원문이 아니라 <b>해시</b>를 재료로 쓴다 — 멱등 키는 저장돼 로그·덤프에 남을 수 있고,
     * 거기 자격증명 원문이 섞이면 그게 곧 유출이다.
     */
    private String logoutIdempotencyKey(LogoutRequest request) {
        if (request.idempotencyKey() != null && !request.idempotencyKey().isBlank()) {
            return request.idempotencyKey().trim();
        }
        return "logout:" + InternalCommands.fingerprint(
                TokenHasher.sha256Hex(request.refreshToken()), request.deviceToken());
    }
}
