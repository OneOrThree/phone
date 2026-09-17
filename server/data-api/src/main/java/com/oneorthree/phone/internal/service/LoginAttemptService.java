package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptStatus;
import com.oneorthree.phone.auth.repository.domain.LoginTokenMaterials;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.internal.dto.LoginAttemptExecuteRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupResponse;
import com.oneorthree.phone.internal.dto.LoginSessionResponse;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.support.OnboardingCompletion;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 로그인 시도 원장의 조합 지점 (GROMO-1908, 계정 LLD §3).
 *
 * <h2>왜 {@code internal} 인가</h2>
 * 이 서비스는 {@code auth}(원장·JWT·{@code AuthService})와 {@code user}(온보딩 판정)를 <b>같이</b>
 * 쓴다. {@code auth} 안에 두면 {@code AuthService} 를 옆으로 참조하게 되는데, 도메인 높이 표는 같은
 * 층 사이의 참조를 금지한다({@code DomainLayerRulesTest}). 조합하는 서비스의 자리는 L10 {@code
 * internal} 이다.
 *
 * <h2>조회와 실행을 나눈 이유</h2>
 * LLD §3 은 「제공자 교환 전에 내구 시도를 <b>먼저</b> 조회한다」이고, 재생 분기의 「IdP 교환 횟수는
 * 0」이다. 두 표면을 나누면 그 0 이 <b>호출 횟수로 관측된다</b> — 하나로 합쳐 내부에서 분기하면
 * 「정말 다시 안 불렀는가」를 밖에서 확인할 방법이 없고, 회귀가 조용히 들어온다.
 *
 * <h2>트랜잭션 경계</h2>
 * {@link #execute} 는 <b>트랜잭션이 아니다</b>. 안에서 부르는 {@code AuthService.socialLogin} 이
 * {@code NOT_SUPPORTED} 이고(제공자 네트워크 호출 동안 DB 잠금을 쥐지 않기 위해서다, LLD §3-3),
 * 실제로도 잠금을 들고 IdP 를 기다리면 로그인 하나가 그 사용자의 모든 쓰기를 막는다. 그래서
 * 「선점(TX) → 제공자 호출(TX 밖) → 확정(TX)」 세 조각이고, 조각마다 프록시를 타도록
 * {@code self} 를 거친다({@code AuthService} 의 같은 패턴).
 */
@Service
public class LoginAttemptService {

    /**
     * 고정 복구 마감 (LLD §3 「기술 초기값은 준비/응답 복구 창 5분」).
     *
     * <p>이 창을 넘기면 재생하지 않고 새 제공자 인증을 요구한다. 길게 잡을수록 응답 유실에 강하지만
     * 그만큼 오래된 자격이 되살아날 수 있는 창도 길어진다. 설계가 값을 정해 뒀고 운영에서 흔들 이유가
     * 아직 없어 상수로 둔다 — 튜닝이 필요해지면 그때 설정으로 올린다.
     */
    private static final Duration RECOVERY_WINDOW = Duration.ofMinutes(5);

    /**
     * PENDING 실행권의 임차 시간. 실행자가 죽으면 이 시간 뒤 다른 요청이 회수한다 — 회수가 없으면
     * 그 attempt id 는 영원히 409 가 되어 사용자가 갇힌다. 제공자 왕복 + Business deadline 보다
     * 넉넉해야 정상 실행 중인 시도를 남이 가로채지 않는다.
     */
    private static final Duration EXECUTION_LEASE = Duration.ofSeconds(30);

    private final LoginAttemptRepository loginAttemptRepository;
    private final UserQueryService userQueryService;
    private final AuthService authService;
    private final AuthSessionService authSessionService;
    private final JwtProvider jwtProvider;
    private final LoginAttemptService self;

    /**
     * ⚠️ 생성자를 <b>손으로</b> 쓴다 — {@code @RequiredArgsConstructor} 로는 안 된다.
     *
     * <p>이 레포에는 {@code lombok.config} 가 없어 Lombok 이 필드의 {@code @Lazy} 를 생성자 «파라미터»
     * 로 복사하지 않는다. 그러면 자기 주입이 즉시 해석되어 컨텍스트 기동이
     * {@code BeanCurrentlyInCreationException} 으로 죽는다(실측: data-api 테스트 818건 동시 실패).
     * {@code AuthService} 가 같은 이유로 생성자를 손으로 쓰고 있다.
     *
     * @param self 자기 자신 프록시. 자기 호출로는 {@code @Transactional} 프록시를 타지 못해
     *             「선점(TX) → 제공자 호출(TX 밖) → 확정(TX)」 경계가 통째로 사라진다
     */
    public LoginAttemptService(LoginAttemptRepository loginAttemptRepository,
            UserQueryService userQueryService, AuthService authService,
            AuthSessionService authSessionService, JwtProvider jwtProvider,
            @Lazy LoginAttemptService self) {
        this.loginAttemptRepository = loginAttemptRepository;
        this.userQueryService = userQueryService;
        this.authService = authService;
        this.authSessionService = authSessionService;
        this.jwtProvider = jwtProvider;
        this.self = self;
    }

    /**
     * 제공자 교환 전 조회 — <b>부수효과가 없다</b>.
     *
     * <p>선점을 여기서 하지 않는 이유: 조회만 하고 실행하지 않는 호출자(재시도를 포기한 앱, 중간에
     * 죽은 Business)가 매번 PENDING 을 남기면 임차 만료를 기다리는 시간이 곧 사용자의 대기가 된다.
     * 선점은 실제로 실행할 {@link #execute} 가 한다.
     *
     * @return 저장된 결과가 있으면 재생용 응답, 없으면 {@link LoginAttemptLookupResponse#miss()}
     */
    @Transactional
    public LoginAttemptLookupResponse lookup(LoginAttemptLookupRequest request) {
        LoginAttempt attempt = loginAttemptRepository.findById(request.attemptId()).orElse(null);
        if (attempt == null) {
            return LoginAttemptLookupResponse.miss();
        }
        Instant now = Instant.now();
        guard(attempt, request.digestKeyId(), request.credentialDigest(), now);

        if (attempt.getStatus() == LoginAttemptStatus.COMPLETED) {
            return LoginAttemptLookupResponse.replay(replayOf(attempt));
        }
        // PENDING — 임차가 살아 있으면 남이 지금 제공자를 부르는 중이다. 여기서 miss 를 주면
        // 호출자가 같은 일회용 code 를 동시에 교환한다.
        if (now.isBefore(attempt.getClaimedAt().plus(EXECUTION_LEASE))) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_IN_PROGRESS);
        }
        return LoginAttemptLookupResponse.miss();
    }

    /**
     * 실행권을 잡고 제공자 교환까지 수행한다 (LLD §3-3).
     *
     * <p>조회와 이 호출 사이에 남이 끼어들 수 있으므로 <b>여기서 모든 판정을 다시 한다</b>. 조회
     * 결과를 인가로 재사용하면 그 사이에 커밋된 완료·폐기를 무시하게 된다(LLD §3 「무락 사전 조회는
     * 잠글 ID 발견용이고 인가 결과로 사용하지 않는다」).
     */
    public LoginSessionResponse execute(LoginAttemptExecuteRequest request) {
        // 선택 AT 를 «승격 자격» 으로 인정하기 전에 그 세션이 지금 살아 있는지 본다. 시도를
        // 선점하기 «전» 이다 — 거절할 요청이 원장에 PENDING 을 남기면 안 된다.
        self.gateOptionalSession(request.callerAccessToken());

        LoginSessionResponse replayed = self.claim(request);
        if (replayed != null) {
            // 조회와 실행 사이에 남이 끝냈다. 다시 교환하지 않고 그 결과를 그대로 준다.
            return replayed;
        }

        // ── 여기부터 트랜잭션 밖이다. DB 잠금을 쥐지 않은 채 제공자를 부른다. ──
        String authorization = request.callerAccessToken() == null
                ? null : "Bearer " + request.callerAccessToken();
        SocialLoginResponse login =
                authService.socialLogin(request.provider(), request.credential(), authorization);

        return self.complete(request.attemptId(), login);
    }

    /**
     * 선택 AT 의 <b>세션 폐기 관문</b> (계정 LLD §2.1 · 「선택 AT의 세션 폐기 관문」).
     *
     * <h2>서명 검증만으로 승격 권한을 인정하지 않는다</h2>
     * Business 는 AT 의 서명·타입·만료까지만 본다. 그것으로 충분하다고 보면 <b>로그아웃한 게스트의
     * AT</b> 가 남은 만료 시간(운영 AT 3600초) 동안 그대로 승격 자격으로 남는다 — 개별 로그아웃은
     * 사용자를 비활성화하지도 {@code authGeneration} 을 올리지도 않으므로(LLD §2.4), <b>세션 행의
     * 폐기 여부가 그 창을 닫는 유일한 울타리다</b>. 그래서 서명으로 증명된 subject·sid 의 세션을
     * 잠그고 활성·세대 일치를 확인한다.
     *
     * <p>{@code sid} 없는 구 AT 는 <b>거절</b>한다 — 어느 세션에서 발급됐는지 증명할 수 없어 폐기
     * fence 를 적용할 방법이 아예 없기 때문이다(LLD: 「현재 자료로 원 자격의 결합을 입증할 수 없으면
     * 새 로그인에서 명시 거절」). 이 공개 경로는 신규라 그런 토큰을 보내는 기존 클라이언트가 없다.
     * 무효 AT 를 익명 로그인으로 조용히 강등하는 {@code AuthService.resolveCaller} 의 legacy 동작을
     * 여기서 «앞질러» 막는 것이고, legacy {@code /api/v1/auth/*} 경로의 동작은 그대로 둔다(LLD §2.1
     * 「기존 legacy 경로의 선택 AT 동작은 별도 보존한다」).
     *
     * <p>⚠️ 적용 지점은 <b>실행 하나</b>다. 승격이 실제로 일어나는 자리가 여기뿐이기 때문이다.
     * 결과 재생(lookup)에는 선택 AT 가 실려 오지 않으며, 재생은 이미 그 시도에 발급된 같은 토큰을
     * 돌려줄 뿐 새 권한을 만들지 않는다. 재생·prepare 시점의 관문 재적용은 LLD 가 적은 후속 범위다.
     *
     * @throws AuthException 403 {@code SESSION_NOT_ACTIVE} — Business 가 공개 401 로 매핑한다.
     *                       서비스 자격 거부(401)와 «구분되는» 상태를 쓰는 기존 규율이다
     *                       ({@code InternalHostTransferService} 와 같다)
     */
    @Transactional
    public void gateOptionalSession(String callerAccessToken) {
        // ponytail: 관문은 execute 한 곳. 재생(lookup)·재준비에는 선택 AT 가 실려 오지 않아 재검사가
        // 없다 — 재생은 새 권한을 만들지 않으므로 천장은 「폐기된 원 세션으로 이미 발급된 같은 토큰을
        // 한 번 더 받는 것」이다. LLD 의 4지점 공통 적용이 필요해지면 LoginAttemptLookupRequest 에
        // callerAccessToken 을 싣고 lookup 에서도 이 메서드를 부른다.
        if (callerAccessToken == null) {
            return;
        }
        UUID userId = jwtProvider.extractUserId(callerAccessToken);
        UUID sessionId = jwtProvider.extractSessionId(callerAccessToken);
        Long generation = jwtProvider.extractAuthGeneration(callerAccessToken);
        // 탈퇴한 주체면 여기서 404 다 — 폐기 판정보다 계정 부재가 «먼저»라는 LLD §1 의 순서 그대로.
        User user = userQueryService.getCaller(userId);

        if (sessionId == null || generation == null
                || generation.longValue() != user.getAuthGeneration()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
        if (authSessionService.verifySession(userId, sessionId).filter(AuthSession::isActive).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
    }

    /**
     * 실행권 선점.
     *
     * @return 이 호출이 선점했으면 {@code null}(호출자가 제공자를 부른다),
     *         이미 끝난 시도면 재생할 결과
     */
    @Transactional
    public LoginSessionResponse claim(LoginAttemptExecuteRequest request) {
        Instant now = Instant.now();
        int claimed = loginAttemptRepository.insertClaim(
                request.attemptId(), request.digestKeyId(), request.credentialDigest(),
                request.provider().name(), request.credentialKind(), request.termsVersion(),
                now, now.plus(RECOVERY_WINDOW));
        if (claimed == 1) {
            return null;
        }

        LoginAttempt attempt = loginAttemptRepository.findById(request.attemptId())
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));
        guard(attempt, request.digestKeyId(), request.credentialDigest(), now);

        if (attempt.getStatus() == LoginAttemptStatus.COMPLETED) {
            return replayOf(attempt);
        }
        // PENDING. 임차가 살아 있으면 남이 실행 중이고, 만료됐다면 «조건부로» 회수한다 —
        // 무조건 UPDATE 로 바꾸면 회수 자체가 동시 교환 창이 된다.
        if (now.isBefore(attempt.getClaimedAt().plus(EXECUTION_LEASE))
                || loginAttemptRepository.reclaimExpired(
                        request.attemptId(), attempt.getClaimedAt(), now) == 0) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_IN_PROGRESS);
        }
        return null;
    }

    /** 제공자 검증 결과를 원장에 확정한다. 토큰 원문 대신 고정 서명 재료만 남긴다. */
    @Transactional
    public LoginSessionResponse complete(UUID attemptId, SocialLoginResponse login) {
        LoginAttempt attempt = loginAttemptRepository.findById(attemptId)
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));

        UUID userId = jwtProvider.extractUserId(login.accessToken());
        // 방금 로그인한 «본인» 이므로 caller 축이다 — 부재는 404 USER_NOT_FOUND 이고 앱의 답은
        // 재로그인이다(GROMO-1655 의 caller/target 구분).
        User user = userQueryService.getCaller(userId);
        boolean onboardingComplete = OnboardingCompletion.isComplete(user);

        LoginTokenMaterials materials =
                jwtProvider.freezeMaterials(login.accessToken(), login.refreshToken());
        attempt.complete(userId, login.sessionId(), onboardingComplete, materials, Instant.now());

        return new LoginSessionResponse(
                login.accessToken(), login.refreshToken(), userId, onboardingComplete);
    }

    /**
     * 재생·실행 공통 관문. <b>순서가 계약이다</b>.
     *
     * <p>key id 를 digest 보다 «먼저» 본다. 뒤집으면 Business 의 digest 비밀 교체가 digest 불일치로
     * 보여 {@code IDEMPOTENCY_KEY_REUSED} 가 되는데, LLD §3 이 그 판정을 명시적으로 금지한다 —
     * 자격을 바르게 들고 온 정상 사용자가 배포 한 번에 409 로 막히고 앱은 그걸 「키 오용」으로 읽는다.
     */
    private void guard(LoginAttempt attempt, String digestKeyId, String digest, Instant now) {
        if (!attempt.getDigestKeyId().equals(digestKeyId)) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        if (!attempt.getCredentialDigest().equals(digest)) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
        if (attempt.getStatus() == LoginAttemptStatus.INVALIDATED) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        if (!now.isBefore(attempt.getRecoveryExpiresAt())) {
            // 창이 끝났다는 사실을 내구화한다 — 남겨 두면 시계가 흔들릴 때 되살아난다.
            attempt.invalidate();
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
    }

    /**
     * 고정 재료로 원 토큰을 다시 만들어 결과를 복원한다.
     *
     * <p>새로 발급하지 «않는다». 새로 발급하면 문자열이 달라져 저장된 RT 해시와 어긋나고, 앱이 받은
     * RT 로는 refresh 가 되지 않는다 — 「같은 결과 재생」이 아니라 조용한 세션 파손이다.
     */
    private LoginSessionResponse replayOf(LoginAttempt attempt) {
        LoginTokenMaterials materials = new LoginTokenMaterials(
                Boolean.TRUE.equals(attempt.getTokenGuest()),
                attempt.getAuthGeneration(),
                attempt.getAccessIssuedAt(), attempt.getAccessExpiresAt(),
                attempt.getRefreshIssuedAt(), attempt.getRefreshExpiresAt(),
                attempt.getRefreshJti());
        return new LoginSessionResponse(
                jwtProvider.replayAccessToken(attempt.getUserId(), attempt.getSessionId(), materials),
                jwtProvider.replayRefreshToken(attempt.getUserId(), materials),
                attempt.getUserId(),
                Boolean.TRUE.equals(attempt.getOnboardingComplete()));
    }
}
