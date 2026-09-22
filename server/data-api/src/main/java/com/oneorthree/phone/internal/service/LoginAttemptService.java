package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptStatus;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptSwitchPhase;
import com.oneorthree.phone.auth.repository.domain.LoginTokenMaterials;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.internal.dto.LoginAttemptExecuteRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupResponse;
import com.oneorthree.phone.internal.dto.LoginSessionResponse;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.support.OnboardingCompletion;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import io.jsonwebtoken.JwtException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
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
@Slf4j
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
    private final AccountWithdrawalService accountWithdrawalService;
    private final JwtProvider jwtProvider;
    private final SocialAccountRepository socialAccountRepository;
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
            AuthSessionService authSessionService, AccountWithdrawalService accountWithdrawalService,
            JwtProvider jwtProvider, SocialAccountRepository socialAccountRepository,
            @Lazy LoginAttemptService self) {
        this.loginAttemptRepository = loginAttemptRepository;
        this.userQueryService = userQueryService;
        this.authService = authService;
        this.authSessionService = authSessionService;
        this.accountWithdrawalService = accountWithdrawalService;
        this.jwtProvider = jwtProvider;
        this.socialAccountRepository = socialAccountRepository;
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
        if (attempt.getSwitchPhase() != null) {
            guardSwitchReplay(attempt, request);
        }

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
        // 이미 전환 증거가 있는 attempt 는 더 이상 일반 로그인 실행이 아니다. 특히
        // GUEST_WITHDRAWN source 는 의도적으로 죽어 있으므로 live optional-session 관문을
        // 다시 통과시키면 재개 자체가 불가능해진다. 이 분기는 저장된 digest·의도·source tuple을
        // 먼저 재검증한 뒤에만 열린다.
        LoginAttemptSwitchPhase phase = self.switchPhaseForExecute(request);
        if (phase == LoginAttemptSwitchPhase.VERIFIED) {
            self.discardGuestAndCheckpoint(request);
            return self.completeTargetSwitch(request);
        }
        if (phase == LoginAttemptSwitchPhase.GUEST_WITHDRAWN) {
            return self.completeTargetSwitch(request);
        }

        // 선택 AT 를 «승격 자격» 으로 인정하기 전에 그 세션이 지금 살아 있는지 본다. 시도를
        // 선점하기 «전» 이다 — 거절할 요청이 원장에 PENDING 을 남기면 안 된다.
        self.gateOptionalSession(request.callerAccessToken());

        LoginSessionResponse replayed = self.claim(request);
        if (replayed != null) {
            // 조회와 실행 사이에 남이 끝냈다. 다시 교환하지 않고 그 결과를 그대로 준다.
            return replayed;
        }

        // ── 여기부터 트랜잭션 밖이다. DB 잠금을 쥐지 않은 채 제공자를 부른다. ──
        String providerId = authService.verifyProviderId(request.provider(), request.credential());

        UUID callerUserId = request.callerAccessToken() == null
                ? null : jwtProvider.extractUserId(request.callerAccessToken());
        if (request.accountSwitchConfirmed() && callerUserId != null
                && authService.isLinkedToAnotherUser(request.provider(), providerId, callerUserId)) {
            // 게스트의 확정 전환만 checkpoint 프로토콜을 탄다. 회원 caller의 기존 account-switch
            // 동작은 유지한다(그 경로에는 폐기할 guest source가 없다).
            if (Boolean.TRUE.equals(jwtProvider.extractIsGuest(request.callerAccessToken()))) {
                self.prepareSwitch(request, providerId);
                self.discardGuestAndCheckpoint(request);
                return self.completeTargetSwitch(request);
            }
            return self.complete(request.attemptId(), switchToLinkedAccount(
                    request.provider(), providerId, callerUserId));
        }

        String authorization = request.callerAccessToken() == null
                ? null : "Bearer " + request.callerAccessToken();
        SocialLoginResponse login =
                authService.loginWithProviderId(request.provider(), providerId, authorization);

        return self.complete(request.attemptId(), login);
    }

    /**
     * execute 직전의 내구 phase를 읽는다. phase 행은 recovery window와 immutable intent,
     * 서명된 source tuple을 이 자리에서 다시 묶는다. {@code null}은 일반/NONE 경로다.
     */
    @Transactional
    public LoginAttemptSwitchPhase switchPhaseForExecute(LoginAttemptExecuteRequest request) {
        LoginAttempt attempt = loginAttemptRepository.findByAttemptIdForUpdate(request.attemptId())
                .orElse(null);
        if (attempt == null || attempt.getSwitchPhase() == null) {
            return null;
        }
        Instant now = Instant.now();
        guard(attempt, request.digestKeyId(), request.credentialDigest(), now);
        guardSwitchIntent(attempt, request.provider().name(), request.credentialKind(),
                request.termsVersion(), request.accountSwitchConfirmed());
        if (request.callerAccessToken() == null
                || !ownsSwitchSource(attempt, request.callerAccessToken())) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        // 완료 결과는 새 실행권을 만들지 않는 replay다. 반면 PENDING phase 재개는 반드시
        // 같은 30초 lease를 얻어야 한다. attempt 행 잠금과 claimed_at 조건부 UPDATE를 함께 써
        // VERIFIED 경쟁 패자가 이전 phase를 들고 discard에 진입하는 일을 막는다.
        if (attempt.getStatus() != LoginAttemptStatus.COMPLETED) {
            if (now.isBefore(attempt.getClaimedAt().plus(EXECUTION_LEASE))
                    || loginAttemptRepository.reclaimExpired(
                            request.attemptId(), attempt.getClaimedAt(), now) != 1) {
                throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_IN_PROGRESS);
            }
        }
        return attempt.getSwitchPhase();
    }

    /**
     * 확인받은 <b>기존 회원 계정으로의 전환</b> (GROMO-1994 · 정책 「인증·게스트 계정」).
     *
     * <p>정책은 두 문장이다. 「이미 다른 회원 계정에 연결된 소셜 계정이면 기존 회원 계정을 우선하되,
     * 사용자에게 전환 여부를 안내하고 명시적으로 확인받는다. 취소하면 게스트 상태와 데이터는
     * 유지한다」 · 「기존 회원 계정으로 전환을 확정하면 게스트의 고양이·섬 소속·개인 집중 기록은
     * 폐기하고 기존 회원 데이터를 불러온다. 이미 섬에 적립된 공동 물고기와 공동 거래 기록은
     * 되돌리지 않는다」.
     *
     * <h2>1단계 = 기존 409 그대로다</h2>
     * 확인 없이 온 요청은 {@code AuthService.loginOrRegister} 가 예전부터 던지던 409
     * {@code SOCIAL_ACCOUNT_ALREADY_LINKED} 로 거절되고 게스트 상태·데이터는 그대로 남는다.
     * 전용 코드를 새로 만들지 않았다 — 이미 「이 소셜은 남의 계정이다」를 정확히 뜻하고, 앱은 그
     * 코드 하나로 전환 확인 다이얼로그를 띄운다.
     *
     * <h2>2단계 = 「폐기 → 대상 계정 로그인」</h2>
     * 정책의 「폐기」는 <b>탈퇴</b> 다. 같은 문단이 요구하는 「주민이 있는 섬의 게스트 방장은 방장
     * 위임 또는 섬 정리를 끝내고, 진행 중인 집중 세션도 종료한 뒤 전환한다」가 이미
     * {@link AccountWithdrawalService#withdraw} 의 계약이기 때문이다 — 방장은 400
     * {@code HOST_WITHDRAW} 로 <b>전환 자체가 거절</b> 되고(그 트랜잭션이 통째로 롤백되므로 아무것도
     * 파기되지 않는다), 진행 중 집중 세션은 같은 트랜잭션이 종결하며, 섬에 적립된 공동 물고기·주문
     * 원장은 손대지 않는다. 같은 판정을 여기 다시 쓰면 두 벌이 갈라진다.
     *
     * <p>탈퇴가 커밋되면 그 게스트는 더 이상 <b>활성 게스트</b> 가 아니므로
     * {@code loginOrRegister} 의 {@code findActiveGuestByIdForUpdate} 가 비고, 승격 분기 대신
     * 「이미 있는 소셜 계정으로 로그인」 분기를 탄다 — 그래서 승격 경로에 새 가지를 내지 않았다.
     * 선택 AT 를 <b>넘기지 않는 것</b>이 핵심이다: 탈퇴가 그 세션을 이미 폐기하고
     * {@code authGeneration} 을 올렸으므로 넘기면 자기 자신이 만든 상태 때문에 401 이 된다.
     * 세션 폐기 관문은 이 메서드보다 «먼저» {@link #gateOptionalSession} 이 봤다.
     *
     * <h2>트랜잭션이 둘인 이유와 그 천장</h2>
     * {@code withdraw} 는 마지막 단계가 소셜 벌크 DELETE 라 영속성 컨텍스트를 비운다 — 로그인과 한
     * 트랜잭션에 담을 수 없다. 그래서 「탈퇴 커밋 → 로그인」 두 조각이고, <b>탈퇴만 커밋된 채 로그인이
     * 실패하는 창</b> 이 남는다. 그때 사용자가 잃는 것은 이미 폐기에 동의한 게스트 데이터뿐이고 대상
     * 회원 계정은 그대로라, 새 로그인(선택 AT 없이)으로 복구된다. 순서를 뒤집으면 「전환은 됐는데
     * 게스트가 유령 주민으로 남는」 되돌릴 수 없는 쪽으로 깨지므로 이 순서가 맞다.
     * <p>재개도 이 순서라 안전하다 — 이미 탈퇴한 게스트로 다시 오면 아래 활성 검사가 걸러 탈퇴를
     * 건너뛰고 로그인만 이어 한다.
     */
    private SocialLoginResponse switchToLinkedAccount(Provider provider, String providerId, UUID guestUserId) {
        // 활성 «게스트» 일 때만 폐기한다. 비게스트 계정 전환은 정책이 파기를 요구하지 않고(두 계정을
        // 합치지 않을 뿐이다, 계정 LLD §2.1), 이미 탈퇴한 재개 요청은 여기서 그냥 지나간다.
        userQueryService.findActive(guestUserId)
                .filter(User::isGuest)
                .ifPresent(guest -> accountWithdrawalService.withdraw(guest.getId()));
        return authService.loginWithProviderId(provider, providerId, null);
    }

    /**
     * 확인된 전환 시도에 <b>검증 증거를 박아 {@code VERIFIED} 로 전이</b>한다 (GROMO-1992).
     *
     * <p>제공자 검증은 호출부가 트랜잭션 «밖»에서 끝내고 {@code providerId} 만 넘긴다 — 원문
     * credential 은 여기 오지도 저장하지도 않는다. 이 시점에 박는 source tuple(user·sid·gen)과
     * target 식별자가 탈퇴 뒤 재개의 유일한 근거가 된다.
     *
     * <p>판정 순서는 {@link #guard} 와 같은 규율이다 — digest·불변 의도 대조가 먼저, 그 뒤
     * 「지금 살아 있는 게스트의 AT 인가」와 「기존 회원 연동인가」를 검증한다. 어느 하나라도
     * 어긋나면 아무것도 쓰지 않고 롤백된다.
     *
     * @param request    실행 요청 — 시도 id·digest·불변 의도(provider·kind·terms·confirmed)와
     *                   source 게스트의 AT 를 담는다
     * @param providerId 제공자가 확인한 계정 식별자 (IdP 호출은 이미 끝났다)
     */
    @Transactional
    public void prepareSwitch(LoginAttemptExecuteRequest request, String providerId) {
        Instant now = Instant.now();
        LoginAttempt attempt = loginAttemptRepository.findByAttemptIdForUpdate(request.attemptId())
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));
        guard(attempt, request.digestKeyId(), request.credentialDigest(), now);
        if (attempt.getStatus() != LoginAttemptStatus.PENDING) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        guardSwitchIntent(attempt, request.provider().name(), request.credentialKind(),
                request.termsVersion(), request.accountSwitchConfirmed());

        // source: 우리 서명의 unexpired access AT + sid/gen — 그리고 그 주체가 «지금» 살아 있는
        // 게스트여야 한다. user 행을 «먼저» 배타 잠그고(커밋 전 동시 승격·탈퇴와 직렬화) 그 뒤
        // sid/gen·세션을 본다 — 기존 user→session 잠금 순서다. 탈퇴가 끝난 source 의 재개는 이
        // 관문을 통과하지 못하고(그 경로는 저장 증거로 재개한다), 비게스트 주체는 애초에 폐기
        // 대상이 아니다.
        String token = request.callerAccessToken();
        if (token == null || !jwtProvider.isTokenValid(token)
                || !JwtProvider.TYPE_ACCESS.equals(jwtProvider.extractType(token))) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        UUID sourceUserId = jwtProvider.extractUserId(token);
        UUID sourceSessionId = jwtProvider.extractSessionId(token);
        Long sourceGeneration = jwtProvider.extractAuthGeneration(token);
        User source = userQueryService.getCallerForUpdate(sourceUserId);
        if (!source.isGuest()) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        if (sourceSessionId == null || sourceGeneration == null
                || sourceGeneration.longValue() != source.getAuthGeneration()
                || authSessionService.verifySession(sourceUserId, sourceSessionId)
                        .filter(AuthSession::isActive).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }

        // target: IdP 가 확인한 providerId 의 «기존» 연동 행이어야 하고, 그 주인은 활성 회원
        // (비게스트)이어야 한다. owner 는 여기서 쓰지 않으므로 share 잠금까지다 — guest source 만
        // 다루는 이 경로에 target 쓰기 잠금은 없다. 해제됐거나 주인이 사라진 연동은 전환 대상이 아니다.
        SocialAccount linkage = socialAccountRepository
                .findByProviderAndProviderId(request.provider(), providerId)
                .filter(account -> account.getDeletedAt() == null)
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));
        User owner = userQueryService.findActiveForShare(linkage.getUser().getId())
                .filter(candidate -> !candidate.isGuest())
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));

        try {
            attempt.verifySwitch(source.getId(), sourceSessionId, sourceGeneration,
                    owner.getId(), linkage.getId(), now);
        } catch (IllegalStateException e) {
            // 같은 시도에 «다른» 전환 증거 — digest 불일치와 같은 409 로 접는다.
            throw new OutboxException(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
    }

    /**
     * {@code VERIFIED} 전환 시도의 <b>source 게스트 폐기 + {@code GUEST_WITHDRAWN} 체크포인트</b> —
     * 둘은 <b>한 트랜잭션</b>이다 (GROMO-1992).
     *
     * <p>폐기만 커밋되고 phase 가 {@code VERIFIED} 로 남으면, 재개 요청이 저장 증거를 들고 와도
     * 아래 활성 게스트 관문을 통과하지 못해 그 시도는 영원히 갇힌다. 반대로 phase 만 전이되면
     * 폐기 없는 전환 완료로 이어진다. 그래서 {@link AccountWithdrawalService#withdraw} 를 같은
     * REQUIRED 트랜잭션에 참여시키고, 그 맨 끝의 소셜 벌크 DELETE 가 영속성 컨텍스트를 비운
     * «뒤»에 조건부 native UPDATE({@link LoginAttemptRepository#markSwitchGuestWithdrawn})로
     * phase 를 닫는다 — 관리 엔티티의 dirty checking 은 그 지점에서 유실되므로 쓸 수 없다.
     * UPDATE 가 1 을 돌려주지 않으면 예외로 폐기까지 통째로 롤백한다.
     */
    @Transactional
    public void discardGuestAndCheckpoint(LoginAttemptExecuteRequest request) {
        Instant now = Instant.now();
        LoginAttempt attempt = loginAttemptRepository.findByAttemptIdForUpdate(request.attemptId())
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));
        guard(attempt, request.digestKeyId(), request.credentialDigest(), now);
        if (attempt.getStatus() != LoginAttemptStatus.PENDING
                || attempt.getSwitchPhase() != LoginAttemptSwitchPhase.VERIFIED) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        guardSwitchIntent(attempt, request.provider().name(), request.credentialKind(),
                request.termsVersion(), request.accountSwitchConfirmed());
        String token = request.callerAccessToken();
        if (token == null || !ownsSwitchSource(attempt, token)) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }

        // source user 행을 «먼저» 배타 잠근 뒤 sid/gen·세션을 본다 — prepareSwitch 와 같은
        // user→session 잠금 순서다. 저장 증거의 세대가 현재와 어긋났거나 sid 세션이 죽어 있으면
        // 지금 폐기할 자격이 아니다.
        UUID sourceUserId = attempt.getSwitchSourceUserId();
        User source = userQueryService.getCallerForUpdate(sourceUserId);
        if (!source.isGuest()) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        if (source.getAuthGeneration() != attempt.getSwitchSourceAuthGeneration()
                || authSessionService.verifySession(sourceUserId, attempt.getSwitchSourceSessionId())
                        .filter(AuthSession::isActive).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }

        // target: 저장된 연동 행이 아직 같은 provider·같은 주인을 가리키고 그 주인이 활성
        // 회원이어야 한다 — 폐기 동의의 대상이 바뀌었으면 진행하지 않는다. write 잠금은 없다
        // (prepareSwitch 와 같은 이유다).
        SocialAccount linkage = socialAccountRepository
                .findById(attempt.getSwitchTargetSocialAccountId())
                .filter(account -> account.getDeletedAt() == null
                        && account.getProvider() == request.provider()
                        && account.getUser().getId().equals(attempt.getSwitchTargetUserId()))
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));
        userQueryService.findActiveForShare(linkage.getUser().getId())
                .filter(candidate -> !candidate.isGuest())
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));

        accountWithdrawalService.withdraw(sourceUserId);
        // withdraw 말미의 EM clear 때문에 여기서 entity dirty checking 은 죽어 있다 — 조건부
        // UPDATE 만이 전이를 보장한다. 0 이면 폐기와 함께 통째로 롤백.
        if (loginAttemptRepository.markSwitchGuestWithdrawn(request.attemptId(), now) != 1) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
    }

    /**
     * {@code GUEST_WITHDRAWN} 전환 시도의 <b>대상 회원 로그인 + 결과 확정</b> — 한 트랜잭션
     * (GROMO-1992). 게스트 폐기와 대상 로그인 사이의 유실 창에서 재개되는 마지막 조각이다.
     *
     * <p>source 는 이미 폐기됐으므로 활성 게스트 조회는 <b>하지 않는다</b> — 저장 증거와 AT 의
     * 대조({@link #ownsSwitchSource})가 source 자격을 증명한다. target 은 처음부터 배타 잠금이다
     * (share→write 승급 금지 — 이 트랜잭션이 그 행의 RT 해시를 갱신한다). providerId 는 요청이
     * 아니라 <b>저장된 연동 행에서만</b> 읽는다 — 이 경로는 새 IdP 왕복을 만들지 않는다.
     *
     * <p>로그인은 {@link AuthService#loginOrRegister} 가 REQUIRED 로 같은 트랜잭션에 참여한다 —
     * 세션 오픈·RT 해시 갱신이 attempt 완료와 함께 커밋되거나 함께 롤백된다. 대상 불일치(다른
     * 계정으로 로그인됐다)면 통째로 롤백해 phase 를 {@code GUEST_WITHDRAWN} 그대로 둔다.
     */
    @Transactional
    public LoginSessionResponse completeTargetSwitch(LoginAttemptExecuteRequest request) {
        Instant now = Instant.now();
        LoginAttempt attempt = loginAttemptRepository.findByAttemptIdForUpdate(request.attemptId())
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));
        guard(attempt, request.digestKeyId(), request.credentialDigest(), now);
        guardSwitchIntent(attempt, request.provider().name(), request.credentialKind(),
                request.termsVersion(), request.accountSwitchConfirmed());
        String token = request.callerAccessToken();
        if (token == null || !ownsSwitchSource(attempt, token)) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }

        if (attempt.getStatus() == LoginAttemptStatus.COMPLETED) {
            // 동시 후행 — 이미 확정된 결과를 그대로 재생한다. 새 세션은 만들지 않는다.
            return replayOf(attempt);
        }
        if (attempt.getStatus() != LoginAttemptStatus.PENDING
                || attempt.getSwitchPhase() != LoginAttemptSwitchPhase.GUEST_WITHDRAWN) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }

        // target user 행을 처음부터 배타 잠근다 — 잠근 뒤 매핑을 다시 본다. 비게스트·활성이
        // 아니면 폐기 동의의 대상이 아니다.
        UUID targetUserId = attempt.getSwitchTargetUserId();
        User target = userQueryService.getCallerForUpdate(targetUserId);
        if (target.isGuest()) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        SocialAccount linkage = socialAccountRepository
                .findById(attempt.getSwitchTargetSocialAccountId())
                .filter(account -> account.getDeletedAt() == null
                        && account.getProvider() == request.provider()
                        && account.getUser().getId().equals(targetUserId))
                .orElseThrow(() -> new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE));

        SocialLoginResponse login = authService.loginOrRegister(
                request.provider(), linkage.getProviderId(), null, null, null, null);
        if (!jwtProvider.extractUserId(login.accessToken()).equals(targetUserId)) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        // 같은 TX 안에서 기존 확정 헬퍼 재사용 — complete 가 attempt 를 다시 조회한다.
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
     * 전환 시도의 재생에는 선택 AT 가 실려 오지만(GROMO-1992), 그쪽이 요구하는 것은 「기록된 source
     * 자격인가」이고 활성 세션 여부가 아니라 이 관문과 답이 다르다 — lookup 은
     * {@link #guardSwitchReplay} 가 본다.
     *
     * @throws AuthException 403 {@code SESSION_NOT_ACTIVE} — Business 가 공개 401 로 매핑한다.
     *                       서비스 자격 거부(401)와 «구분되는» 상태를 쓰는 기존 규율이다
     *                       ({@code InternalHostTransferService} 와 같다)
     */
    @Transactional
    public void gateOptionalSession(String callerAccessToken) {
        // ponytail: 관문은 execute 한 곳. 일반 재생(lookup)은 새 권한을 만들지 않아 재검사가 없고,
        // 전환 재생은 lookup 의 guardSwitchReplay 가 source 증거로 본다 — 이 메서드의 활성 세션
        // 관문과 목적이 달라 공유하지 않는다.
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
                Boolean.TRUE.equals(request.accountSwitchConfirmed()), now, now.plus(RECOVERY_WINDOW));
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
                login.accessToken(), login.refreshToken(), userId, onboardingComplete,
                // 1회용 자격은 «여기서만» 나간다 — 원장에 남기지 않으므로 재생이 되살릴 수 없다.
                login.deviceBootstrap());
    }

    /**
     * 재생·실행 공통 관문. <b>순서가 계약이다</b>.
     *
     * <p>key id 를 digest 보다 «먼저» 본다. 뒤집으면 Business 의 digest 비밀 교체가 digest 불일치로
     * 보여 {@code IDEMPOTENCY_KEY_REUSED} 가 되는데, LLD §3 이 그 판정을 명시적으로 금지한다 —
     * 자격을 바르게 들고 온 정상 사용자가 배포 한 번에 409 로 막히고 앱은 그걸 「키 오용」으로 읽는다.
     */
    private void guard(LoginAttempt attempt, String digestKeyId, String digest, Instant now) {
        // 결과 계정이 탈퇴했으면 digest 대조보다 «먼저» 404 USER_NOT_FOUND 다 (계정 LLD §1 순서 · §3 INVALIDATED).
        // 탈퇴가 digest 를 파기하므로(GROMO-1801) 대조 자체가 불가능하고, 뒤의 재생 거절은 401 이라 앱이
        // 탈퇴 확정 대신 refresh 로 흘러간다. 결과 사용자가 없는 PENDING 시도는 여기서 걸리지 않는다.
        if (attempt.getUserId() != null) {
            userQueryService.getCaller(attempt.getUserId());
        }
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
     * 전환 시도의 재생 관문 (GROMO-1992) — 기존 digest 관문 <b>뒤</b>, replay 분기 <b>앞</b>이다.
     *
     * <p>COMPLETED 전환 결과를 source AT 없이 되살리면, 탈퇴가 끝난 게스트의 자격 없이도 전환 세션을
     * 받는 우회가 된다. 그래서 저장된 불변 의도(provider·kind·terms·confirmed)와 요청의 다섯 값을
     * 모두 대조하고, source AT 의 user·sid·gen 이 저장 증거와 정확히 같은지 본다.
     *
     * <p>{@link #gateOptionalSession} 을 쓰지 «않는다» — 탈퇴가 끝난 source 는 세션 폐기·세대 상승이
     * 정상이라 활성 세션 관문은 여기서 틀린 도구다. 필요한 것은 「이 AT 가 기록된 source 자격인가」
     * 뿐이다.
     */
    private void guardSwitchReplay(LoginAttempt attempt, LoginAttemptLookupRequest request) {
        String token = request.callerAccessToken();
        if (token == null || request.provider() == null || request.credentialKind() == null
                || request.termsVersion() == null || request.accountSwitchConfirmed() == null) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        // 같은 attempt 의 «다른 불변 의도»다 — digest 불일치와 같은 409 로 접는다.
        guardSwitchIntent(attempt, request.provider().name(), request.credentialKind(),
                request.termsVersion(), Boolean.TRUE.equals(request.accountSwitchConfirmed()));
        if (!ownsSwitchSource(attempt, token)) {
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
    }

    /**
     * 저장된 불변 의도와 요청의 provider·kind·terms·confirmed 를 대조한다 — 하나라도 다르면
     * 「같은 시도의 다른 의도」라 {@code IDEMPOTENCY_KEY_CONFLICT} 다. 재생({@link #guardSwitchReplay})
     * 과 최초 증거 기록({@link #prepareSwitch})이 같은 규칙을 공유한다.
     */
    private void guardSwitchIntent(LoginAttempt attempt, String provider, String credentialKind,
            String termsVersion, boolean confirmed) {
        if (!confirmed || !attempt.isAccountSwitchConfirmed()
                || !attempt.getProvider().equals(provider)
                || !attempt.getCredentialKind().equals(credentialKind)
                || !attempt.getTermsVersion().equals(termsVersion)) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
    }

    /**
     * 우리 서명의 unexpired <b>access</b> AT 이고, 그 user·sid·gen 이 저장된 source 증거와
     * 정확히 같은가. 위조·만료·refresh·구 AT(sid/gen 없음)·다른 주체를 모두 같은 false 로 접어
     * 세부 원인을 노출하지 않는다 — 토큰 원문은 로그에도 싣지 않는다.
     */
    private boolean ownsSwitchSource(LoginAttempt attempt, String token) {
        try {
            if (!jwtProvider.isTokenValid(token)
                    || !JwtProvider.TYPE_ACCESS.equals(jwtProvider.extractType(token))) {
                return false;
            }
            UUID sessionId = jwtProvider.extractSessionId(token);
            Long generation = jwtProvider.extractAuthGeneration(token);
            return sessionId != null && generation != null
                    && jwtProvider.extractUserId(token).equals(attempt.getSwitchSourceUserId())
                    && sessionId.equals(attempt.getSwitchSourceSessionId())
                    && generation.equals(attempt.getSwitchSourceAuthGeneration());
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    /**
     * 고정 재료로 원 토큰을 다시 만들어 결과를 복원한다 — <b>원장의 RT 해시와 맞을 때만</b>.
     *
     * <p>새로 발급하지 «않는다». 새로 발급하면 문자열이 달라져 저장된 RT 해시와 어긋나고, 앱이 받은
     * RT 로는 refresh 가 되지 않는다 — 「같은 결과 재생」이 아니라 조용한 세션 파손이다.
     *
     * <h2>천장 — 서명키 회전 창에서는 재생이 «불가»하다</h2>
     * {@code JwtProvider} 는 키가 <b>하나</b>다(키 링·{@code kid} 없음). 재서명은 «지금» 키로 하므로
     * 복구 창 5분 안에 {@code jwt.secret} 이 배포로 바뀌면 재생 RT 는 최초 발급 바이트와 달라진다.
     * 그 RT 를 그대로 내보내면 {@code auth_sessions.refresh_token_hash} 와 어긋나, 앱은 refresh 가
     * 안 되는 토큰을 «성공» 으로 받는다. 그래서 재서명한 RT 의 SHA-256 을 결과 세션 행의 해시와
     * 대조해 다르면 attempt 를 {@code INVALIDATED} 로 닫고 새 로그인을 요구한다 — 401
     * ({@code LOGIN_ATTEMPT_UNUSABLE} → Business 가 공개 {@code UNAUTHORIZED} 로 매핑). 같은 대조가
     * 「결과 세션이 폐기됐다」와 「앱이 그 사이 refresh 로 RT 를 회전시켰다」도 함께 잡는다 — 셋 다
     * 원 RT 는 이미 죽은 토큰이라 답이 같다. 답은 같지만 <b>로그의 사유는 가른다</b>
     * ({@link ReplayRejection}) — 서명키 회전은 배포 시각에 붙은 버스트라 시계열 모양이 다른데, 하나의
     * 401 로 접혀 있으면 온콜이 평소 잡음과 회전 창 문제를 로그로 구분하지 못한다.
     *
     * <p>ponytail: 회전 창의 재생은 포기한다(fail-closed, 천장 = 키 배포 직후 5분 동안의 응답 유실
     * 재시도가 재로그인이 된다). 승급 경로는 {@code JwtProvider} 에 키 링을 두고 발급 시 {@code kid}
     * 를 {@link LoginTokenMaterials} 에 고정해 «그 키» 로 재서명하는 것 — LLD §3 「JWT 에 key ID 를
     * 싣고 … 이전 키는 검증 전용으로 유지」. 이 티켓 범위 밖이다.
     */
    private LoginSessionResponse replayOf(LoginAttempt attempt) {
        LoginTokenMaterials materials = new LoginTokenMaterials(
                Boolean.TRUE.equals(attempt.getTokenGuest()),
                attempt.getAuthGeneration(),
                attempt.getAccessIssuedAt(), attempt.getAccessExpiresAt(),
                attempt.getRefreshIssuedAt(), attempt.getRefreshExpiresAt(),
                attempt.getRefreshJti());
        String refreshToken = jwtProvider.replayRefreshToken(attempt.getUserId(), materials);

        Optional<AuthSession> session = authSessionService
                .verifySession(attempt.getUserId(), attempt.getSessionId())
                .filter(AuthSession::isActive);
        ReplayRejection rejection = null;
        if (session.isEmpty()) {
            rejection = ReplayRejection.SESSION_REVOKED;
        } else if (!TokenHasher.sha256Hex(refreshToken).equals(session.get().getRefreshTokenHash())) {
            rejection = ReplayRejection.REFRESH_HASH_MISMATCH;
        }
        if (rejection != null) {
            // 사유는 «로그에서만» 갈린다. 공개 응답·코드·상태는 둘 다 같다. 토큰·해시는 싣지 않는다.
            log.warn("로그인 시도 재생 거절 attemptId={} sessionId={} reason={}",
                    attempt.getAttemptId(), attempt.getSessionId(), rejection);
            // 닫힌 상태를 원장에 «남긴다» — 다음 재시도가 같은 대조를 반복하며 세션 행 잠금을 잡지 않게.
            attempt.invalidate();
            throw new AuthException(AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        }
        return new LoginSessionResponse(
                jwtProvider.replayAccessToken(attempt.getUserId(), attempt.getSessionId(), materials),
                refreshToken,
                attempt.getUserId(),
                Boolean.TRUE.equals(attempt.getOnboardingComplete()),
                // 재생에는 deviceBootstrap 이 «없다». 자격 원문은 발급 1회만 존재하고 어디에도
                // 저장하지 않으므로(auth_sessions 는 SHA-256 만 갖는다) 되살릴 길이 없다. 새로
                // 발급하는 것은 답이 아니다 — 최초 응답을 받은 앱이 든 값이 그 순간 무효가 되고,
                // 그쪽이야말로 자격을 실제로 쓰고 있는 앱이다(AuthSessionService.rotateActive 의
                // 「자격이 이미 있으면 그대로 둔다」와 같은 판단). 자격 없이 받은 앱은 기존 기기
                // 등록 경로로 내려간다 — 알림 서버가 그 경로를 여전히 받는다.
                null);
    }

    /**
     * 재생 거절 사유 — <b>로그 전용</b>. 공개 응답·에러 코드·attempt 상태는 두 사유가 같다
     * ({@code INVALIDATED} + 401).
     *
     * <p>가르는 이유는 온콜의 판독이다. {@code REFRESH_HASH_MISMATCH} 가 배포 시각에 붙은 버스트로
     * 보이면 서명키 회전 창의 영향이고, 드문드문이면 앱이 그 사이 refresh 로 RT 를 회전시킨 정상
     * 경합이다. {@code SESSION_REVOKED} 는 로그아웃·탈퇴·타인 sid 로, 회전과 무관한 평소 잡음이다.
     * 하나의 401 로 접혀 있으면 이 셋이 한 선으로 보여 불필요한 롤백이나 영향 과소평가로 이어진다.
     */
    private enum ReplayRejection {
        /** 결과 세션 행이 없거나 폐기됐다. */
        SESSION_REVOKED,
        /** 세션은 활성인데 재서명 RT 의 해시가 원장과 다르다 — 서명키 회전 또는 중간 refresh 회전. */
        REFRESH_HASH_MISMATCH
    }
}
