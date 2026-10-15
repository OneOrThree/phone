package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptStatus;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptSwitchPhase;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.internal.dto.LoginAttemptExecuteRequest;
import com.oneorthree.phone.internal.dto.LoginSessionResponse;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * {@code LoginAttemptService.prepareSwitch}·{@code discardGuestAndCheckpoint} 의 실제 프록시·
 * 실제 PG 검증 (GROMO-1992). mock self 없이 커밋된 원장·계정 상태로 증거 저장·거절·원자성을
 * 고정한다. execute 라우팅·대상 로그인 완료는 후속 checkpoint 다.
 */
@SpringBootTest
class LoginAttemptSwitchCheckpointIntegrationTest {

    /** (provider, provider_id) 전체 유니크 — 공유 DB 의 다른 테스트·이전 실행과 겹치지 않게 건마다 새 값. */
    private static String providerId() {
        return "apple-sub-" + UUID.randomUUID();
    }

    @DynamicPropertySource
    static void wiring(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    LoginAttemptService loginAttemptService;
    /** 실 구현을 그대로 타는 spy — phase UPDATE 0 주입만 가로채고 나머지는 실제 PG 로 간다. */
    @MockitoSpyBean
    LoginAttemptRepository loginAttemptRepository;
    @MockitoSpyBean
    AuthService auth;
    /** freezeMaterials 실패 주입용 spy — stub 없는 호출은 전부 실제 구현으로 간다. */
    @MockitoSpyBean
    JwtProvider jwt;
    @Autowired
    AuthSessionRepository authSessionRepository;
    @Autowired
    UserQueryService userQueryService;
    @Autowired
    AuthSessionService authSessionService;
    @Autowired
    SocialAccountRepository socialAccountRepository;
    @Autowired
    PlatformTransactionManager transactions;
    @PersistenceContext
    EntityManager em;

    @Test
    @DisplayName("prepareSwitch — live 게스트 AT + 기존 회원 연동이면 VERIFIED 증거 여섯 개를 박는다")
    void prepareStoresVerifiedEvidence() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID sourceUserId = jwt.extractUserId(guest.accessToken());
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();

        loginAttemptService.prepareSwitch(request(attemptId, guest.accessToken()), providerId);

        LoginAttempt attempt = loginAttemptRepository.findById(attemptId).orElseThrow();
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(attempt.isAccountSwitchConfirmed()).isTrue();
        assertThat(attempt.getSwitchSourceUserId()).isEqualTo(sourceUserId);
        assertThat(attempt.getSwitchSourceSessionId()).isEqualTo(guest.sessionId());
        assertThat(attempt.getSwitchSourceAuthGeneration()).isEqualTo(0);
        assertThat(attempt.getSwitchTargetUserId()).isEqualTo(target.userId());
        assertThat(attempt.getSwitchTargetSocialAccountId()).isEqualTo(target.socialAccountId());
        assertThat(attempt.getSwitchVerifiedAt()).isNotNull();
    }

    @Test
    @DisplayName("prepareSwitch — 위조·구형(sid/gen 없음)·비게스트 source AT 는 거절하고 증거를 남기지 않는다")
    void prepareRejectsBadSourceTokens() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID sourceUserId = jwt.extractUserId(guest.accessToken());
        String providerId = providerId();
        memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();

        // 다른 키로 서명된 위조 AT.
        String forged = new JwtProvider("other-secret-key-that-is-at-least-256-bits-long-xxx",
                3600, 2_592_000, 7_776_000)
                .generateAccessToken(sourceUserId, true, 0, guest.sessionId());
        assertThatThrownBy(() -> loginAttemptService.prepareSwitch(request(attemptId, forged), providerId))
                .isInstanceOf(AuthException.class);
        // sid/gen 없는 구형 AT — 서명은 진짜지만 세션 결합을 증명할 수 없다.
        String legacy = jwt.generateAccessToken(sourceUserId, true);
        assertThatThrownBy(() -> loginAttemptService.prepareSwitch(request(attemptId, legacy), providerId))
                .isInstanceOf(AuthException.class);
        // 비게스트(회원) 주체의 정상 AT — 폐기 대상이 아니라 거절.
        String memberToken = jwt.generateAccessToken(memberUser().getId(), false, 0, UUID.randomUUID());
        assertThatThrownBy(() -> loginAttemptService.prepareSwitch(request(attemptId, memberToken), providerId))
                .isInstanceOf(AuthException.class);

        LoginAttempt attempt = loginAttemptRepository.findById(attemptId).orElseThrow();
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(attempt.getSwitchPhase()).isNull();
        assertThat(attempt.getSwitchSourceUserId()).isNull();
    }

    @Test
    @DisplayName("discardGuestAndCheckpoint — 게스트 비활성·전 세션 폐기·GUEST_WITHDRAWN 이 같은 커밋에 담긴다")
    void discardWithdrawsGuestAndMarksPhase() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID sourceUserId = jwt.extractUserId(guest.accessToken());
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();
        loginAttemptService.prepareSwitch(request(attemptId, guest.accessToken()), providerId);

        loginAttemptService.discardGuestAndCheckpoint(request(attemptId, guest.accessToken()));

        // 폐기 — 소프트딜리트·세대 상승·세션 폐기가 같은 커밋이다.
        User withdrawn = tx().execute(status -> userQueryService.getAny(sourceUserId));
        assertThat(withdrawn.isDeleted()).isTrue();
        assertThat(withdrawn.getAuthGeneration()).isGreaterThan(0);
        boolean sessionActive = Boolean.TRUE.equals(tx().execute(status -> authSessionService
                .verifySession(sourceUserId, guest.sessionId()).map(AuthSession::isActive).orElse(false)));
        assertThat(sessionActive).isFalse();
        // 체크포인트 — phase 만 전이되고 증거는 그대로다.
        LoginAttempt attempt = loginAttemptRepository.findById(attemptId).orElseThrow();
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(attempt.getSwitchSourceUserId()).isEqualTo(sourceUserId);
        assertThat(attempt.getSwitchTargetUserId()).isEqualTo(target.userId());
        assertThat(attempt.getSwitchVerifiedAt()).isNotNull();
        // 대상 회원·연동은 손대지 않는다.
        assertThat(socialAccountRepository.findById(target.socialAccountId())).isPresent();
    }

    @Test
    @DisplayName("discardGuestAndCheckpoint — phase UPDATE 0 이면 게스트·세션·증거가 통째로 롤백된다")
    void discardRollsBackWhenCheckpointFails() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID sourceUserId = jwt.extractUserId(guest.accessToken());
        String providerId = providerId();
        memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();
        loginAttemptService.prepareSwitch(request(attemptId, guest.accessToken()), providerId);

        // 주입: 조건부 UPDATE 가 0 행을 돌려주는 상황 — withdraw 는 실제로 수행된다.
        doReturn(0).when(loginAttemptRepository).markSwitchGuestWithdrawn(any(), any());
        assertThatThrownBy(
                () -> loginAttemptService.discardGuestAndCheckpoint(request(attemptId, guest.accessToken())))
                .isInstanceOf(AuthException.class);

        // 롤백 증명은 실제 커밋 상태로만 — 게스트·세션·증거 모두 discard 이전 그대로다.
        User source = tx().execute(status -> userQueryService.getAny(sourceUserId));
        assertThat(source.isDeleted()).isFalse();
        assertThat(source.getAuthGeneration()).isZero();
        boolean sessionActive = Boolean.TRUE.equals(tx().execute(status -> authSessionService
                .verifySession(sourceUserId, guest.sessionId()).map(AuthSession::isActive).orElse(false)));
        assertThat(sessionActive).isTrue();
        LoginAttempt attempt = loginAttemptRepository.findById(attemptId).orElseThrow();
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.VERIFIED);
        assertThat(attempt.getSwitchSourceUserId()).isEqualTo(sourceUserId);
    }

    @Test
    @DisplayName("completeTargetSwitch — 대상 세션 + COMPLETED 가 같은 커밋이고 재호출은 같은 결과를 재생한다")
    void completeCreatesTargetSessionAndReplays() {
        GuestLoginResponse guest = auth.guestLogin();
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();
        loginAttemptService.prepareSwitch(request(attemptId, guest.accessToken()), providerId);
        loginAttemptService.discardGuestAndCheckpoint(request(attemptId, guest.accessToken()));

        LoginSessionResponse first =
                loginAttemptService.completeTargetSwitch(request(attemptId, guest.accessToken()));

        assertThat(first.userId()).isEqualTo(target.userId());
        // 대상 세션 1개가 attempt 완료와 같은 커밋에 담겼다.
        assertThat(activeSessions(target.userId())).isEqualTo(1);
        LoginAttempt attempt = loginAttemptRepository.findById(attemptId).orElseThrow();
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.COMPLETED);
        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(attempt.getUserId()).isEqualTo(target.userId());

        // 동시 후행 — 저장 결과 재생, 새 세션 0.
        LoginSessionResponse replayed =
                loginAttemptService.completeTargetSwitch(request(attemptId, guest.accessToken()));
        assertThat(replayed.accessToken()).isEqualTo(first.accessToken());
        assertThat(replayed.refreshToken()).isEqualTo(first.refreshToken());
        assertThat(replayed.userId()).isEqualTo(target.userId());
        assertThat(activeSessions(target.userId())).isEqualTo(1);
    }

    @Test
    @DisplayName("completeTargetSwitch — 확정 실패 주입이면 대상 세션·RT·attempt 완료가 통째로 롤백되고 재시도는 세션 1개를 연다")
    void completeRollsBackWhenCompletionFails() {
        GuestLoginResponse guest = auth.guestLogin();
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();
        loginAttemptService.prepareSwitch(request(attemptId, guest.accessToken()), providerId);
        loginAttemptService.discardGuestAndCheckpoint(request(attemptId, guest.accessToken()));

        // 주입: 세션 오픈 뒤 freezeMaterials 에서 실패 — loginOrRegister 의 쓰기도 같이 굴러가야 한다.
        doThrow(new IllegalStateException("injected"))
                .when(jwt).freezeMaterials(any(), any());
        assertThatThrownBy(
                () -> loginAttemptService.completeTargetSwitch(request(attemptId, guest.accessToken())))
                .isInstanceOf(IllegalStateException.class);

        // 롤백 증명은 커밋 상태로만 — 대상 세션 없음, RT 해시 미변경, attempt 는 GUEST_WITHDRAWN.
        assertThat(activeSessions(target.userId())).isZero();
        String rtHash = tx().execute(status ->
                userQueryService.getAny(target.userId()).getRefreshTokenHash());
        assertThat(rtHash).isNull();
        LoginAttempt attempt = loginAttemptRepository.findById(attemptId).orElseThrow();
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(attempt.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);

        // 재시도 — 같은 시도가 정상 완료되고 세션은 정확히 1개다.
        doCallRealMethod().when(jwt).freezeMaterials(any(), any());
        LoginSessionResponse retried =
                loginAttemptService.completeTargetSwitch(request(attemptId, guest.accessToken()));
        assertThat(retried.userId()).isEqualTo(target.userId());
        assertThat(activeSessions(target.userId())).isEqualTo(1);
        assertThat(loginAttemptRepository.findById(attemptId).orElseThrow().getStatus())
                .isEqualTo(LoginAttemptStatus.COMPLETED);
    }

    @Test
    @DisplayName("execute — 완료 TX 실패 뒤 GUEST_WITHDRAWN 재개는 IdP·죽은 source gate 없이 세션 하나만 만든다")
    void executeResumesGuestWithdrawnWithoutAnotherProviderCall() {
        GuestLoginResponse guest = auth.guestLogin();
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = UUID.randomUUID();
        LoginAttemptExecuteRequest request = request(attemptId, guest.accessToken());
        doReturn(providerId).when(auth).verifyProviderId(Provider.APPLE, "credential");
        // 첫 execute는 실제 Spring self proxy를 타되, target login 뒤 완료 재료 고정에서 실패시킨다.
        doThrow(new IllegalStateException("injected"))
                .when(jwt).freezeMaterials(any(), any());

        assertThatThrownBy(() -> loginAttemptService.execute(request))
                .isInstanceOf(IllegalStateException.class);
        LoginAttempt checkpoint = loginAttemptRepository.findById(attemptId).orElseThrow();
        assertThat(checkpoint.getSwitchPhase()).isEqualTo(LoginAttemptSwitchPhase.GUEST_WITHDRAWN);
        assertThat(checkpoint.getStatus()).isEqualTo(LoginAttemptStatus.PENDING);
        assertThat(activeSessions(target.userId())).isZero();

        // 아직 살아 있는 lease는 후행 재개를 실행시키지 않는다. 이 거절은 PENDING 행을 바꾸지 않는다.
        assertThatThrownBy(() -> loginAttemptService.execute(request))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LOGIN_ATTEMPT_IN_PROGRESS);
        assertThat(activeSessions(target.userId())).isZero();

        // 만료 뒤에만 phase 실행권을 회수한다. 만료는 생산 상태가 아니라 이 fixture에서만 만든다.
        expireLease(attemptId);
        doCallRealMethod().when(jwt).freezeMaterials(any(), any());
        LoginSessionResponse resumed = loginAttemptService.execute(request);

        assertThat(resumed.userId()).isEqualTo(target.userId());
        assertThat(activeSessions(target.userId())).isEqualTo(1);
        assertThat(loginAttemptRepository.findById(attemptId).orElseThrow().getStatus())
                .isEqualTo(LoginAttemptStatus.COMPLETED);
        verify(auth, times(1)).verifyProviderId(Provider.APPLE, "credential");
    }

    @Test
    @DisplayName("execute — 만료 VERIFIED lease의 동시 재개는 세션 하나와 replay 또는 IN_PROGRESS만 남긴다")
    void concurrentVerifiedExecuteCreatesOneSessionWithoutProviderRetry() throws Exception {
        GuestLoginResponse guest = auth.guestLogin();
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();
        LoginAttemptExecuteRequest request = request(attemptId, guest.accessToken());
        loginAttemptService.prepareSwitch(request, providerId);
        expireLease(attemptId);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        CyclicBarrier start = new CyclicBarrier(2);
        try {
            List<Future<Object>> futures = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                futures.add(executor.submit(() -> {
                    start.await(5, TimeUnit.SECONDS);
                    try {
                        return loginAttemptService.execute(request);
                    } catch (Throwable throwable) {
                        return throwable;
                    }
                }));
            }

            int responses = 0;
            for (Future<Object> future : futures) {
                Object result = future.get(10, TimeUnit.SECONDS);
                if (result instanceof LoginSessionResponse response) {
                    responses++;
                    assertThat(response.userId()).isEqualTo(target.userId());
                } else {
                    assertThat(result).isInstanceOf(AuthException.class);
                    assertThat(((AuthException) result).getErrorCode())
                            .isEqualTo(AuthErrorCode.LOGIN_ATTEMPT_IN_PROGRESS);
                }
            }
            assertThat(responses).isGreaterThanOrEqualTo(1);
            assertThat(activeSessions(target.userId())).isEqualTo(1);
            assertThat(loginAttemptRepository.findById(attemptId).orElseThrow().getStatus())
                    .isEqualTo(LoginAttemptStatus.COMPLETED);
            verify(auth, never()).verifyProviderId(Provider.APPLE, "credential");
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    @DisplayName("execute — GUEST_WITHDRAWN 재개는 다른 source·만료/refresh AT·다른 의도를 실제 PG에서 거절한다")
    void executeRejectsTamperedSourceAndIntent() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID sourceUserId = jwt.extractUserId(guest.accessToken());
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = claimSwitchable();
        loginAttemptService.prepareSwitch(request(attemptId, guest.accessToken()), providerId);
        loginAttemptService.discardGuestAndCheckpoint(request(attemptId, guest.accessToken()));
        expireLease(attemptId);

        String otherSid = jwt.generateAccessToken(sourceUserId, true, 0, UUID.randomUUID());
        String expired = new JwtProvider("test-secret-key-that-is-at-least-256-bits-long-for-hmac-sha256",
                -1, 2_592_000, 7_776_000).generateAccessToken(sourceUserId, true, 0, guest.sessionId());
        String refresh = jwt.generateRefreshToken(sourceUserId, true);
        assertUnusable(new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.APPLE,
                "id_token", "credential", "2026-09", otherSid, true));
        assertUnusable(new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.APPLE,
                "id_token", "credential", "2026-09", expired, true));
        assertUnusable(new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.APPLE,
                "id_token", "credential", "2026-09", refresh, true));
        assertUnusable(new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.APPLE,
                "id_token", "credential", "2026-10", guest.accessToken(), true));
        assertThat(activeSessions(target.userId())).isZero();
    }

    @Test
    @DisplayName("execute — GUEST_WITHDRAWN 재개는 다른 source user/gen·위조/구형 AT·provider/kind/confirmed 변경을 거절한다")
    void executeRejectsRemainingSourceAndIntentTampering() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID sourceUserId = jwt.extractUserId(guest.accessToken());
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID attemptId = withdrawnAttempt(guest, providerId);
        expireLease(attemptId);

        String otherUser = jwt.generateAccessToken(UUID.randomUUID(), true, 0, guest.sessionId());
        String otherGeneration = jwt.generateAccessToken(sourceUserId, true, 1, guest.sessionId());
        String forged = new JwtProvider("other-secret-key-that-is-at-least-256-bits-long-xxx",
                3600, 2_592_000, 7_776_000)
                .generateAccessToken(sourceUserId, true, 0, guest.sessionId());
        String legacy = jwt.generateAccessToken(sourceUserId, true);
        assertUnusable(request(attemptId, otherUser));
        assertUnusable(request(attemptId, otherGeneration));
        assertUnusable(request(attemptId, forged));
        assertUnusable(request(attemptId, legacy));
        assertUnusable(new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.KAKAO,
                "id_token", "credential", "2026-09", guest.accessToken(), true));
        assertUnusable(new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.APPLE,
                "access_token", "credential", "2026-09", guest.accessToken(), true));
        assertUnusable(new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.APPLE,
                "id_token", "credential", "2026-09", guest.accessToken(), false));
        assertThat(activeSessions(target.userId())).isZero();
        verify(auth, never()).verifyProviderId(any(), any());
    }

    @Test
    @DisplayName("execute — VERIFIED·GUEST_WITHDRAWN 모두 target owner soft-delete면 fail-closed다")
    void executeRejectsSoftDeletedTargetOwnerInBothPhases() {
        GuestLoginResponse verifiedGuest = auth.guestLogin();
        String verifiedProviderId = providerId();
        Target verifiedTarget = memberLinked(Provider.APPLE, verifiedProviderId);
        UUID verifiedAttempt = claimSwitchable();
        loginAttemptService.prepareSwitch(request(verifiedAttempt, verifiedGuest.accessToken()), verifiedProviderId);
        softDelete(verifiedTarget.userId());
        expireLease(verifiedAttempt);
        assertRejected(request(verifiedAttempt, verifiedGuest.accessToken()));
        assertThat(activeSessions(verifiedTarget.userId())).isZero();

        GuestLoginResponse withdrawnGuest = auth.guestLogin();
        String withdrawnProviderId = providerId();
        Target withdrawnTarget = memberLinked(Provider.APPLE, withdrawnProviderId);
        UUID withdrawnAttempt = withdrawnAttempt(withdrawnGuest, withdrawnProviderId);
        softDelete(withdrawnTarget.userId());
        expireLease(withdrawnAttempt);
        assertRejected(request(withdrawnAttempt, withdrawnGuest.accessToken()));
        assertThat(activeSessions(withdrawnTarget.userId())).isZero();
        verify(auth, never()).verifyProviderId(any(), any());
    }

    @Test
    @DisplayName("execute — anonymous ordinary login은 새 회원·세션 하나를 만들고 전환 phase를 남기지 않는다")
    void executeAnonymousOrdinaryLogin() {
        UUID attemptId = UUID.randomUUID();
        String providerId = providerId();
        doReturn(providerId).when(auth).verifyProviderId(Provider.APPLE, "credential");

        LoginSessionResponse response = loginAttemptService.execute(new LoginAttemptExecuteRequest(
                attemptId, "key-id", "digest", Provider.APPLE, "id_token", "credential", "2026-09", null,
                false));

        assertThat(response.userId()).isNotNull();
        assertThat(activeSessions(response.userId())).isEqualTo(1);
        assertThat(loginAttemptRepository.findById(attemptId).orElseThrow().getSwitchPhase()).isNull();
        assertThat(userQueryService.getAny(response.userId()).isDeleted()).isFalse();
        verify(auth, times(1)).verifyProviderId(Provider.APPLE, "credential");
    }

    @Test
    @DisplayName("execute — guest confirmed no-conflict는 탈퇴 없이 기존 guest를 promotion한다")
    void executeGuestConfirmedWithoutConflictPromotes() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID guestUserId = jwt.extractUserId(guest.accessToken());
        UUID attemptId = UUID.randomUUID();
        String providerId = providerId();
        doReturn(providerId).when(auth).verifyProviderId(Provider.APPLE, "credential");

        LoginSessionResponse response = loginAttemptService.execute(request(attemptId, guest.accessToken()));

        assertThat(response.userId()).isEqualTo(guestUserId);
        User promoted = tx().execute(status -> userQueryService.getAny(guestUserId));
        assertThat(promoted.isGuest()).isFalse();
        assertThat(promoted.isDeleted()).isFalse();
        assertThat(activeSessions(guestUserId)).isEqualTo(2);
        assertThat(loginAttemptRepository.findById(attemptId).orElseThrow().getSwitchPhase()).isNull();
    }

    @Test
    @DisplayName("execute — non-guest confirmed conflict는 source를 탈퇴시키지 않고 target으로 로그인한다")
    void executeNonGuestConfirmedConflictDoesNotWithdrawSource() {
        SocialLoginResponse source = auth.loginOrRegister(Provider.APPLE, providerId(), null, null, null, null);
        UUID sourceUserId = jwt.extractUserId(source.accessToken());
        String targetProviderId = providerId();
        // target mapping을 fixture에서 별도 생성해 verify 결과와 정확히 결합한다.
        SocialLoginResponse linkedTarget = auth.loginOrRegister(
                Provider.APPLE, targetProviderId, null, null, null, null);
        UUID targetUserId = jwt.extractUserId(linkedTarget.accessToken());
        UUID attemptId = UUID.randomUUID();
        doReturn(targetProviderId).when(auth).verifyProviderId(Provider.APPLE, "credential");

        LoginSessionResponse response = loginAttemptService.execute(request(attemptId, source.accessToken()));

        assertThat(response.userId()).isEqualTo(targetUserId);
        assertThat(tx().execute(status -> userQueryService.getAny(sourceUserId)).isDeleted()).isFalse();
        assertThat(activeSessions(sourceUserId)).isEqualTo(1);
        assertThat(activeSessions(targetUserId)).isEqualTo(2);
        assertThat(loginAttemptRepository.findById(attemptId).orElseThrow().getSwitchPhase()).isNull();
    }

    @Test
    @DisplayName("execute — guest unconfirmed conflict는 409이고 guest 탈퇴·target 세션 생성이 없다")
    void executeGuestUnconfirmedConflictKeepsBothAccounts() {
        GuestLoginResponse guest = auth.guestLogin();
        UUID guestUserId = jwt.extractUserId(guest.accessToken());
        String targetProviderId = providerId();
        SocialLoginResponse target = auth.loginOrRegister(
                Provider.APPLE, targetProviderId, null, null, null, null);
        UUID targetUserId = jwt.extractUserId(target.accessToken());
        UUID attemptId = UUID.randomUUID();
        doReturn(targetProviderId).when(auth).verifyProviderId(Provider.APPLE, "credential");
        LoginAttemptExecuteRequest request = new LoginAttemptExecuteRequest(attemptId, "key-id", "digest",
                Provider.APPLE, "id_token", "credential", "2026-09", guest.accessToken(), false);

        assertThatThrownBy(() -> loginAttemptService.execute(request))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SOCIAL_ACCOUNT_ALREADY_LINKED);
        assertThat(tx().execute(status -> userQueryService.getAny(guestUserId)).isDeleted()).isFalse();
        assertThat(activeSessions(guestUserId)).isEqualTo(1);
        assertThat(activeSessions(targetUserId)).isEqualTo(1);
        assertThat(loginAttemptRepository.findById(attemptId).orElseThrow().getSwitchPhase()).isNull();
    }

    @Test
    @DisplayName("execute — 저장 target social row의 삭제·owner 재결합은 GUEST_WITHDRAWN 재개를 막는다")
    void executeRejectsDeletedOrReboundTarget() {
        GuestLoginResponse guest = auth.guestLogin();
        String providerId = providerId();
        Target target = memberLinked(Provider.APPLE, providerId);
        UUID deletedAttempt = withdrawnAttempt(guest, providerId);
        tx().executeWithoutResult(status -> socialAccountRepository.findById(target.socialAccountId())
                .orElseThrow().setDeletedAt(Instant.now()));
        expireLease(deletedAttempt);
        assertUnusable(request(deletedAttempt, guest.accessToken()));
        assertThat(activeSessions(target.userId())).isZero();

        GuestLoginResponse secondGuest = auth.guestLogin();
        String reboundProviderId = providerId();
        Target reboundTarget = memberLinked(Provider.APPLE, reboundProviderId);
        UUID reboundAttempt = withdrawnAttempt(secondGuest, reboundProviderId);
        User otherOwner = memberUser();
        tx().executeWithoutResult(status -> socialAccountRepository.findById(reboundTarget.socialAccountId())
                .orElseThrow().setUser(otherOwner));
        expireLease(reboundAttempt);
        assertUnusable(request(reboundAttempt, secondGuest.accessToken()));
        assertThat(activeSessions(reboundTarget.userId())).isZero();
        assertThat(activeSessions(otherOwner.getId())).isZero();
    }

    // ---------------------------------------------------------------- 도구

    private int activeSessions(UUID userId) {
        Integer count = tx().execute(status ->
                authSessionRepository.findActiveByUserId(userId).size());
        return count;
    }

    private UUID claimSwitchable() {
        UUID attemptId = UUID.randomUUID();
        Instant now = Instant.now();
        tx().executeWithoutResult(status -> loginAttemptRepository.insertClaim(
                attemptId, "key-id", "digest", "APPLE", "id_token", "2026-09",
                true, now, now.plus(Duration.ofMinutes(5))));
        return attemptId;
    }

    private UUID withdrawnAttempt(GuestLoginResponse guest, String providerId) {
        UUID attemptId = claimSwitchable();
        loginAttemptService.prepareSwitch(request(attemptId, guest.accessToken()), providerId);
        loginAttemptService.discardGuestAndCheckpoint(request(attemptId, guest.accessToken()));
        return attemptId;
    }

    private void assertUnusable(LoginAttemptExecuteRequest request) {
        assertThatThrownBy(() -> loginAttemptService.execute(request))
                // source 위조는 UNUSABLE, immutable intent 변경은 기존 idempotency 409 계약이다.
                .isInstanceOfAny(AuthException.class, OutboxException.class);
    }

    private void assertRejected(LoginAttemptExecuteRequest request) {
        assertThatThrownBy(() -> loginAttemptService.execute(request))
                .isInstanceOf(RuntimeException.class);
    }

    private LoginAttemptExecuteRequest request(UUID attemptId, String callerAccessToken) {
        return new LoginAttemptExecuteRequest(attemptId, "key-id", "digest", Provider.APPLE,
                "id_token", "credential", "2026-09", callerAccessToken, true);
    }

    private void expireLease(UUID attemptId) {
        tx().executeWithoutResult(status -> em.createNativeQuery(
                "UPDATE login_attempts SET claimed_at = :claimedAt WHERE attempt_id = :attemptId")
                .setParameter("claimedAt", Instant.now().minusSeconds(31))
                .setParameter("attemptId", attemptId)
                .executeUpdate());
    }

    private void softDelete(UUID userId) {
        tx().executeWithoutResult(status -> em.createNativeQuery(
                "UPDATE users SET is_deleted = true WHERE id = :userId")
                .setParameter("userId", userId)
                .executeUpdate());
    }

    private User memberUser() {
        return tx().execute(status -> {
            User member = User.builder().isGuest(false).build();
            em.persist(member);
            em.flush();
            return member;
        });
    }

    private Target memberLinked(Provider provider, String providerId) {
        return tx().execute(status -> {
            User member = User.builder().isGuest(false).build();
            em.persist(member);
            SocialAccount linkage = SocialAccount.builder()
                    .user(member).provider(provider).providerId(providerId).build();
            em.persist(linkage);
            em.flush();
            return new Target(member.getId(), linkage.getId());
        });
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    private record Target(UUID userId, UUID socialAccountId) {
    }
}
