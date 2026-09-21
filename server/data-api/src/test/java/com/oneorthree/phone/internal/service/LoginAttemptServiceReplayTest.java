package com.oneorthree.phone.internal.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.repository.domain.LoginAttempt;
import com.oneorthree.phone.auth.repository.domain.LoginAttemptStatus;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupResponse;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;

/**
 * 재생은 <b>원장의 RT 해시와 맞을 때만</b> 나간다 (GROMO-1908, PR #796 리뷰 갭).
 *
 * <p>{@code JwtProvider} 는 키가 하나라 재서명은 «지금» 키로 한다. 발급 뒤 복구 창 안에서
 * {@code jwt.secret} 이 바뀌면 재생 RT 는 원본과 다른 바이트가 되고, 그걸 내보내면 앱은 refresh 가
 * 안 되는 토큰을 «성공» 으로 받는다. 이 테스트는 실제 서명기 두 개(원 키·회전 키)로 그 상황을 만들어
 * <b>잘못된 RT 가 나가지 않는다</b>는 것을 고정한다.
 */
@ExtendWith(MockitoExtension.class)
class LoginAttemptServiceReplayTest {

    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-for-hmac-sha256";
    private static final String ROTATED = "rotated-secret-key-that-is-also-at-least-256-bits-long-xx";
    private static final UUID ATTEMPT = UUID.fromString("cccccccc-0000-7000-8000-000000001908");
    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000001908");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000001908");
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
    /** 거절 사유는 «로그에서만» 갈린다 — 온콜이 보는 그 줄을 그대로 단언한다 ({@code GuestLoginRateLimiterTest} 와 같은 캡처). */
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    private String originalRefresh;
    private LoginAttempt attempt;

    @BeforeEach
    void issueAndComplete() {
        // 최초 로그인: 원 키로 발급하고, 원장에는 고정 서명 재료만 남는다.
        String access = issuer.generateAccessToken(USER, false, 3, SESSION);
        originalRefresh = issuer.generateRefreshToken(USER, false);
        Instant now = Instant.now();
        attempt = LoginAttempt.builder()
                .attemptId(ATTEMPT).status(LoginAttemptStatus.PENDING)
                .digestKeyId(KEY_ID).credentialDigest(DIGEST)
                .provider("APPLE").credentialKind("id_token").termsVersion("2026-09")
                .claimedAt(now).recoveryExpiresAt(now.plus(Duration.ofMinutes(5)))
                .build();
        attempt.complete(USER, SESSION, false, issuer.freezeMaterials(access, originalRefresh), now);
        given(loginAttemptRepository.findById(ATTEMPT)).willReturn(Optional.of(attempt));
        logs.start();
        ((Logger) LoggerFactory.getLogger(LoginAttemptService.class)).addAppender(logs);
    }

    @AfterEach
    void detachLogs() {
        ((Logger) LoggerFactory.getLogger(LoginAttemptService.class)).detachAppender(logs);
    }

    /** 거절은 정확히 한 줄의 WARN 으로 남고, 그 줄에 토큰 원문은 없다. */
    private String rejectionLine() {
        assertThat(logs.list).hasSize(1);
        String line = logs.list.get(0).getFormattedMessage();
        assertThat(line).doesNotContain(originalRefresh).contains("attemptId=" + ATTEMPT);
        return line;
    }

    private LoginAttemptService serviceSignedBy(JwtProvider provider) {
        return new LoginAttemptService(loginAttemptRepository, userQueryService, authService,
                authSessionService, null, provider, null);
    }

    private AuthSession sessionHolding(String refreshToken) {
        return AuthSession.builder().id(SESSION).userId(USER)
                .refreshTokenHash(TokenHasher.sha256Hex(refreshToken)).build();
    }

    @Test
    @DisplayName("같은 키면 원본과 바이트가 같은 RT 를 재생한다")
    void 같은키재생() {
        given(authSessionService.verifySession(USER, SESSION))
                .willReturn(Optional.of(sessionHolding(originalRefresh)));

        LoginAttemptLookupResponse response = serviceSignedBy(issuer)
                .lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST));

        assertThat(response.replayable()).isTrue();
        assertThat(response.session().refreshToken()).isEqualTo(originalRefresh);
        // 재생에는 1회용 자격이 «없다» (GROMO-2037). 원문은 발급 1회만 존재하고 원장에도 세션 행에도
        // 남지 않아 되살릴 길이 없다. 여기서 새로 발급하면 최초 응답을 받은 앱 — 실제로 그 자격을
        // 쓰고 있는 쪽 — 의 값이 그 순간 무효가 된다. 헤더가 없으면 앱은 기존 등록 경로로 내려간다.
        assertThat(response.session().deviceBootstrap()).isNull();
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.COMPLETED);
        assertThat(logs.list).isEmpty();
    }

    @Test
    @DisplayName("발급 뒤 secret 이 바뀌면 잘못된 RT 를 내보내지 않는다 — attempt 를 닫고 재로그인, 사유는 REFRESH_HASH_MISMATCH")
    void 회전된키재생() {
        given(authSessionService.verifySession(USER, SESSION))
                .willReturn(Optional.of(sessionHolding(originalRefresh)));
        LoginAttemptService rotated = serviceSignedBy(new JwtProvider(ROTATED, 3600, 2_592_000, 7_776_000));

        assertThatThrownBy(() -> rotated.lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST)))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.INVALIDATED);
        assertThat(rejectionLine()).contains("reason=REFRESH_HASH_MISMATCH");
    }

    @Test
    @DisplayName("결과 세션이 폐기됐으면 재생하지 않는다 — 죽은 토큰을 «성공» 으로 주지 않는다, 사유는 SESSION_REVOKED")
    void 폐기된세션재생() {
        AuthSession revoked = AuthSession.builder().id(SESSION).userId(USER)
                .refreshTokenHash(TokenHasher.sha256Hex(originalRefresh)).revokedAt(Instant.now()).build();
        given(authSessionService.verifySession(USER, SESSION)).willReturn(Optional.of(revoked));

        assertThatThrownBy(() -> serviceSignedBy(issuer)
                .lookup(new LoginAttemptLookupRequest(ATTEMPT, KEY_ID, DIGEST)))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.LOGIN_ATTEMPT_UNUSABLE);
        assertThat(attempt.getStatus()).isEqualTo(LoginAttemptStatus.INVALIDATED);
        assertThat(rejectionLine()).contains("reason=SESSION_REVOKED");
    }
}
