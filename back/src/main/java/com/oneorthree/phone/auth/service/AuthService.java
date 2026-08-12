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
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
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

import java.util.Date;
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
        CallerToken caller = resolveCaller(authorizationHeader);

        try {
            return self.loginOrRegister(provider, providerId, caller.userId(), caller.guestClaim());
        } catch (DataIntegrityViolationException e) {
            // 소셜 계정 경쟁에서 진 요청 — 승자가 만든 계정으로 새 트랜잭션에서 1회 재시도(present 분기로 정상 로그인).
            // 가입 시 nickname 을 세팅하지 않으므로 여기서 잡히는 DIVE 는 (provider, provider_id) 위반뿐이다.
            return self.loginOrRegister(provider, providerId, caller.userId(), caller.guestClaim());
        }
    }

    /**
     * Authorization 헤더에서 추출한 현재 호출자 정보 (GROMO-1229).
     * guestClaim 은 요청 AT 의 guest 클레임(발급 시점 게스트 여부) — 클레임 없는 구 토큰은 null 이고,
     * 호출부는 null 을 비게스트로 간주한다(현행 폴백 유지, 점진 적용).
     */
    private record CallerToken(UUID userId, Boolean guestClaim) {
        private static final CallerToken ANONYMOUS = new CallerToken(null, null);
    }

    /**
     * Authorization 헤더에서 현재 로그인(게스트) 사용자 id·guest 클레임을 선택적으로 추출한다.
     * 헤더가 없거나 Bearer 형식이 아니거나 토큰이 무효면 ANONYMOUS(=신규 가입 흐름). JwtFilter 를 바꾸지 않기
     * 위해 여기서만 optional 파싱한다 — 유효할 때만 파싱하므로 무효 토큰이 로그인 자체를 막지는 않는다.
     */
    // access 타입만 인정한다 (GROMO-714) — /auth/* 는 JwtFilter 화이트리스트라 필터의 타입 가드를 타지 않는다.
    // 여기가 무제한이면 서명만 유효한 refresh 토큰(또는 type 없는 구 토큰)으로도 게스트를 소셜 계정으로 승격시켜
    // 새 토큰을 받아갈 수 있어, refresh 토큰에 non-refresh 용도가 생기고 fail-closed 컷오버가 뚫린다.
    // 게스트는 원래 자신의 access 토큰을 헤더로 보내므로 access 를 요구해도 정상 흐름은 그대로다.
    private CallerToken resolveCaller(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
            return CallerToken.ANONYMOUS;
        }
        String token = authorizationHeader.substring(7);
        if (!jwtProvider.isTokenValid(token)) {
            return CallerToken.ANONYMOUS;
        }
        if (!JwtProvider.TYPE_ACCESS.equals(jwtProvider.extractType(token))) {
            return CallerToken.ANONYMOUS;
        }
        // guest 클레임은 토큰을 파싱하는 여기서 함께 뽑아 loginOrRegister 로 넘긴다 (GROMO-1229) —
        // 신규 가입 폴백에서 정식 "계정 전환"(비게스트 AT)과 "이미 승격된 게스트의 패자 요청"을
        // 구분하는 유일한 신호다 (DB 상태만으로는 두 경우가 동일하게 보인다).
        return new CallerToken(jwtProvider.extractUserId(token), jwtProvider.extractIsGuest(token));
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
     */
    @Transactional
    public SocialLoginResponse loginOrRegister(Provider provider, String providerId, UUID currentUserId,
                                               Boolean callerGuestClaim) {
        Optional<SocialAccount> socialAccount =
                socialAccountRepository.findByProviderAndProviderId(provider, providerId);

        // 소프트딜리트된 연동 → deletedAt = null 로 복원(재활성화). unique 제약 충돌 방지.
        if (socialAccount.isPresent() && socialAccount.get().getDeletedAt() != null) {
            socialAccount.get().setDeletedAt(null);
        }

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
        user = userRepository.findActiveByIdForUpdate(user.getId())
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // guest 클레임은 발급 시점 상태 (GROMO-1229) — 승격 직후·소셜 로그인은 isGuest=false 라 비게스트 토큰이 나간다.
        String accessToken = jwtProvider.generateAccessToken(user.getId(), user.isGuest());
        String refreshToken = jwtProvider.generateRefreshToken(user.getId(), user.isGuest());
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
                && userRepository.findByIdAndIsDeletedFalse(currentUserId)
                        .filter(caller -> !caller.isGuest())
                        .isPresent();
    }


    @Transactional
    public GuestLoginResponse guestLogin() {
        User newUser = userRepository.save(User.builder().isGuest(true).build());
        createUserSideRows(newUser.getId());

        // 게스트 발급 경로 — guest=true 클레임을 실어, 승격 후 이 토큰으로 오는 요청을 판별한다 (GROMO-1229)
        String accessToken = jwtProvider.generateAccessToken(newUser.getId(), newUser.isGuest());
        String refreshToken = jwtProvider.generateRefreshToken(newUser.getId(), newUser.isGuest());
        newUser.setRefreshTokenHash(TokenHasher.sha256Hex(refreshToken));

        // 게스트 생성은 항상 신규 가입
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.USER_SIGNED_UP,
                Map.of("method", "guest", "is_guest", true));
        userActivityEventLogger.log(newUser.getId().toString(), UserActivityEvent.LOGIN_SUCCEEDED,
                Map.of("is_new_user", true, "method", "guest"));
        return new GuestLoginResponse(accessToken, refreshToken, newUser.isGuest());
    }

    @Transactional
    public TokenRefreshResponse refreshToken(String refreshToken) {
        // refresh 타입만 허용 (GROMO-714) — access·구 토큰(type 없음 = null)은 거부한다.
        // 가드가 try 안에 있어야 extractType 이 만료·서명오류에 던지는 JwtException 도 401 로 변환된다
        // (InvalidTokenException 은 RuntimeException 이라 아래 catch 에 걸리지 않는다).
        // 만료 시각도 여기서 함께 읽는다 — 아래 회전 판정이 토큰을 다시 파싱하면 그 사이 만료된
        // 토큰이 401 이 아니라 500 으로 새는 창이 생긴다.
        Date refreshExpiresAt;
        try {
            if (!JwtProvider.TYPE_REFRESH.equals(jwtProvider.extractType(refreshToken))) {
                throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
            }
            jwtProvider.extractUserId(refreshToken);
            refreshExpiresAt = jwtProvider.extractExpiration(refreshToken);

        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }

        // 조회도 해시로 — 저장과 같은 변환을 거쳐야 매칭된다 (GROMO-713)
        User user = userRepository.findByRefreshTokenHash(TokenHasher.sha256Hex(refreshToken))
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));

        // 재발급도 재발급 시점 유저 상태로 — 게스트가 승격한 뒤 갱신한 AT 는 guest=false 가 된다 (GROMO-1229)
        String newAccessToken = jwtProvider.generateAccessToken(user.getId(), user.isGuest());

        // refresh 회전 (GROMO-1509) — 종전에는 refresh 를 재발급하지 않아 수명이 **로그인 시점부터
        // 고정**이었다. 매일 쓰는 유저도 만료일이 오면 그대로 로그아웃됐고, 게스트에겐 그게 곧 계정
        // 소실이다(guestLogin 은 언제나 새 User 를 만든다). 남은 수명이 절반 밑으로 떨어지면
        // 갈아끼워, 계속 쓰는 한 세션이 끊기지 않게 한다. 회전 안 하는 갱신은 refreshToken=null 로
        // 응답하고 클라이언트는 저장소를 건드리지 않는다.
        if (!jwtProvider.isRefreshRotationDue(refreshExpiresAt, user.isGuest())) {
            return new TokenRefreshResponse(newAccessToken, null);
        }

        // 해시 교체는 엔티티가 아니라 조건부 UPDATE 로 한다 — 위 해시 조회에 락이 없어서, 엔티티에
        // 쓰면 full-row UPDATE 가 낡은 스냅샷으로 탈퇴가 세운 is_deleted·파기된 PII 를 되살린다
        // (User 에 @Version·@DynamicUpdate 없음 — UserRepository.rotateRefreshTokenHash 주석).
        String rotatedRefreshToken = jwtProvider.generateRefreshToken(user.getId(), user.isGuest());
        int rotated = userRepository.rotateRefreshTokenHash(
                user.getId(),
                TokenHasher.sha256Hex(refreshToken),
                TokenHasher.sha256Hex(rotatedRefreshToken));
        if (rotated == 0) {
            // 그 사이 탈퇴·로그아웃·다른 기기 로그인이 먼저 커밋됐다. 끊긴 세션은 되살리지 않는다.
            throw new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
        }
        return new TokenRefreshResponse(newAccessToken, rotatedRefreshToken);
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
