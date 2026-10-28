package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptStatus;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptSwitchPhase;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupResponse;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.Provider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 전환 시도({@code switch_phase != null})의 COMPLETED 재생 관문 (GROMO-1992).
 *
 * <p>source AT·confirmed·불변 의도 없이 전환 결과를 재생하면 「탈퇴가 끝난 게스트의 자격 없이 전환
 * 세션을 받는」 우회가 된다. 이 테스트는 lookup 이 replay 에 닿기 전에 다섯 증거를 모두 대조함을
 * 고정한다 — 거절 케이스는 {@code authSessionService} 가 한 번도 불리지 않음으로 재생 도달을
 * 부정한다({@code replayOf} 의 첫 상호작용이 세션 조회다).
 */
@ExtendWith(MockitoExtension.class)
class LoginAttemptServiceSwitchReplayTest {

    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-for-hmac-sha256";
    private static final UUID ATTEMPT = UUID.fromString("cccccccc-0000-7000-8000-000000001992");
    private static final UUID TARGET_USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000001992");
    private static final UUID TARGET_SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000001992");
    private static final UUID SOURCE_USER = UUID.fromString("dddddddd-0000-0000-0000-000000001992");
    private static final UUID SOURCE_SESSION = UUID.fromString("eeeeeeee-0000-0000-0000-000000001992");
    private static final long SOURCE_GEN = 3;
    private static final String KEY_ID = "key-id";
    private static final String DIGEST = "credential-digest";

    @Mock
    private LoginAttemptRepository loginAttemptRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private AuthService authService;
    @Mock
    private AuthSessionService authSessionService;

    private final JwtProvider issuer = new JwtProvider(SECRET, 3600, 2_592_000, 7_776_000);

    private String sourceAccess;
    private String originalRefresh;
    private LoginAttempt attempt;
    private LoginAttemptService service;

    @BeforeEach
    void completedSwitchAttempt() {
        sourceAccess = issuer.generateAccessToken(SOURCE_USER, true, SOURCE_GEN, SOURCE_SESSION);
        String access = issuer.generateAccessToken(TARGET_USER, false, 9, TARGET_SESSION);
        originalRefresh = issuer.generateRefreshToken(TARGET_USER, false);
        Instant now = Instant.now();
        attempt = LoginAttempt.builder()
                .attemptId(ATTEMPT).status(LoginAttemptStatus.PENDING)
                .digestKeyId(KEY_ID).credentialDigest(DIGEST)
                .provider("APPLE").credentialKind("id_token").termsVersion("2026-09")
                .accountSwitchConfirmed(true)
                .switchPhase(LoginAttemptSwitchPhase.GUEST_WITHDRAWN)
                .switchSourceUserId(SOURCE_USER).switchSourceSessionId(SOURCE_SESSION)
                .switchSourceAuthGeneration(SOURCE_GEN)
                .claimedAt(now).recoveryExpiresAt(now.plus(Duration.ofMinutes(5)))
                .build();
        attempt.complete(TARGET_USER, TARGET_SESSION, true,
                issuer.freezeMaterials(access, originalRefresh), now);
        // lenient — phase null legacy 픽스처 테스트가 같은 키로 다른 행을 다시 스텁한다.
        lenient().when(loginAttemptRepository.findById(ATTEMPT)).thenReturn(Optional.of(attempt));
        service = new LoginAttemptService(loginAttemptRepository, userQueryService, authService,
                authSessionService, null, issuer, null, null);
    }

    private LoginAttemptLookupRequest request(String token) {
        return new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST, token,
                Provider.APPLE, "id_token", "2026-09", true);
    }

    private void rejectedBeforeReplay(LoginAttemptLookupRequest request) {
        assertThatThrownBy(() -> service.lookup(request))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.COMPLETED);
        verifyNoInteractions(authSessionService);
    }

    @Test
    @DisplayName("같은 source AT·같은 불변 의도면 replay 한다")
    void replaysWhenAllEvidenceMatches() {
        given(authSessionService.verifySession(TARGET_USER, TARGET_SESSION))
                .willReturn(Optional.of(AuthSession.builder().id(TARGET_SESSION).userId(TARGET_USER)
                        .refreshTokenHash(TokenHasher.sha256Hex(originalRefresh)).build()));

        LoginAttemptLookupResponse response = service.lookup(request(sourceAccess));

        assertThat(response.replayable()).isTrue();
        assertThat(response.session().refreshToken()).isEqualTo(originalRefresh);
    }

    @Test
    @DisplayName("신규 다섯 필드 중 하나라도 null 이면 UNUSABLE — 재생에 닿지 않는다")
    void rejectsWhenAnyOfFiveFieldsIsMissing() {
        rejectedBeforeReplay(request(null));
        rejectedBeforeReplay(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST, sourceAccess,
                null, "id_token", "2026-09", true));
        rejectedBeforeReplay(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST, sourceAccess,
                Provider.APPLE, null, "2026-09", true));
        rejectedBeforeReplay(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST, sourceAccess,
                Provider.APPLE, "id_token", null, true));
        rejectedBeforeReplay(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST, sourceAccess,
                Provider.APPLE, "id_token", "2026-09", null));
    }

    @Test
    @DisplayName("confirmed=false·provider·kind·terms 불일치는 409 CONFLICT — 같은 시도의 다른 의도다")
    void rejectsADifferentIntentAsConflict() {
        assertThatThrownBy(() -> service.lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID,
                DIGEST, sourceAccess, Provider.APPLE, "id_token", "2026-09", false)))
                .isInstanceOf(OutboxException.class)
                .hasFieldOrPropertyWithValue("errorCode", OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        assertThatThrownBy(() -> service.lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID,
                DIGEST, sourceAccess, Provider.KAKAO, "id_token", "2026-09", true)))
                .isInstanceOf(OutboxException.class)
                .hasFieldOrPropertyWithValue("errorCode", OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        assertThatThrownBy(() -> service.lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID,
                DIGEST, sourceAccess, Provider.APPLE, "access_token", "2026-09", true)))
                .isInstanceOf(OutboxException.class)
                .hasFieldOrPropertyWithValue("errorCode", OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        assertThatThrownBy(() -> service.lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID,
                DIGEST, sourceAccess, Provider.APPLE, "id_token", "2026-10", true)))
                .isInstanceOf(OutboxException.class)
                .hasFieldOrPropertyWithValue("errorCode", OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        verifyNoInteractions(authSessionService);
    }

    @Test
    @DisplayName("다른 user·sid·gen 의 AT 는 UNUSABLE — 저장된 source 증거와 달라야 거절이다")
    void rejectsAnAccessTokenForADifferentSource() {
        rejectedBeforeReplay(request(issuer.generateAccessToken(
                UUID.randomUUID(), true, SOURCE_GEN, SOURCE_SESSION)));
        rejectedBeforeReplay(request(issuer.generateAccessToken(
                SOURCE_USER, true, SOURCE_GEN, UUID.randomUUID())));
        rejectedBeforeReplay(request(issuer.generateAccessToken(
                SOURCE_USER, true, SOURCE_GEN + 1, SOURCE_SESSION)));
    }

    @Test
    @DisplayName("sid·gen 없는 구 AT 는 UNUSABLE — source 결합을 증명할 수 없다")
    void rejectsAnOldAccessTokenWithoutSessionClaims() {
        rejectedBeforeReplay(request(issuer.generateAccessToken(SOURCE_USER, true)));
    }

    @Test
    @DisplayName("위조·만료·refresh 토큰은 모두 같은 UNUSABLE 401 로 접는다")
    void rejectsForgedExpiredAndRefreshTokens() {
        rejectedBeforeReplay(request("not-a-token"));
        rejectedBeforeReplay(request(
                new JwtProvider("other-secret-key-that-is-also-at-least-256-bits-long-xxx",
                        3600, 2_592_000, 7_776_000)
                        .generateAccessToken(SOURCE_USER, true, SOURCE_GEN, SOURCE_SESSION)));
        rejectedBeforeReplay(request(new JwtProvider(SECRET, -1, 2_592_000, 7_776_000)
                .generateAccessToken(SOURCE_USER, true, SOURCE_GEN, SOURCE_SESSION)));
        rejectedBeforeReplay(request(issuer.generateRefreshToken(SOURCE_USER, true)));
    }

    @Test
    @DisplayName("phase null 인 기존 COMPLETED 행은 신규 필드가 비어도 그대로 replay 한다")
    void keepsLegacyReplayWorking() {
        Instant now = Instant.now();
        LoginAttempt legacy = LoginAttempt.builder()
                .attemptId(ATTEMPT).status(LoginAttemptStatus.PENDING)
                .digestKeyId(KEY_ID).credentialDigest(DIGEST)
                .provider("APPLE").credentialKind("id_token").termsVersion("2026-09")
                .claimedAt(now).recoveryExpiresAt(now.plus(Duration.ofMinutes(5)))
                .build();
        String access = issuer.generateAccessToken(TARGET_USER, false, 9, TARGET_SESSION);
        String refresh = issuer.generateRefreshToken(TARGET_USER, false);
        legacy.complete(TARGET_USER, TARGET_SESSION, false,
                issuer.freezeMaterials(access, refresh), now);
        given(loginAttemptRepository.findById(ATTEMPT)).willReturn(Optional.of(legacy));
        given(authSessionService.verifySession(TARGET_USER, TARGET_SESSION))
                .willReturn(Optional.of(AuthSession.builder().id(TARGET_SESSION).userId(TARGET_USER)
                        .refreshTokenHash(TokenHasher.sha256Hex(refresh)).build()));

        LoginAttemptLookupResponse response = service.lookup(new LoginAttemptLookupRequest(
                ATTEMPT, KEY_ID, DIGEST, null, null, null, null, null));

        assertThat(response.replayable()).isTrue();
        assertThat(response.session().refreshToken()).isEqualTo(refresh);
    }

    @Test
    @DisplayName("digest 관문의 순서·코드는 바뀌지 않는다 — key 불일치 401 이 digest 불일치 409 보다 먼저다")
    void keepsDigestGuardOrderOnSwitchRows() {
        assertThatThrownBy(() -> service.lookup(new LoginAttemptLookupRequest(ATTEMPT, "other-key",
                DIGEST, sourceAccess, Provider.APPLE, "id_token", "2026-09", true)))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        assertThatThrownBy(() -> service.lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID,
                "other-digest", sourceAccess, Provider.APPLE, "id_token", "2026-09", true)))
                .isInstanceOf(OutboxException.class)
                .hasFieldOrPropertyWithValue("errorCode", OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        verifyNoInteractions(authSessionService);
    }
}
