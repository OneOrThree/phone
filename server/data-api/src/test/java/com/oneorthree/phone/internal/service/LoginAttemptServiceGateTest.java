package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 선택 AT 의 <b>세션 폐기 관문</b> (GROMO-1908, 계정 LLD §2.1 「선택 AT의 세션 폐기 관문」).
 *
 * <p>Business 가 서명·만료를 이미 봤다는 사실은 여기서 전제다. 이 테스트가 고정하는 것은 그 «다음»
 * 이다 — 서명이 멀쩡해도 세션 원장이 「폐기됨」이면 승격 자격이 아니라는 것. 로그아웃은
 * {@code authGeneration} 을 올리지 않으므로(LLD §2.4) 이 판정이 빠지면 로그아웃한 게스트의 AT 가
 * 남은 만료 시간 동안 그대로 승격 자격으로 남는다.
 */
@ExtendWith(MockitoExtension.class)
class LoginAttemptServiceGateTest {

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000001908");
    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-000000001909");
    private static final String TOKEN = "signed-access-token";

    @Mock
    private LoginAttemptRepository loginAttemptRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private AuthService authService;
    @Mock
    private AuthSessionService authSessionService;
    @Mock
    private JwtProvider jwtProvider;

    private LoginAttemptService service;

    @BeforeEach
    void setUp() {
        // self 프록시는 execute 의 조각 경계용이다 — 관문 메서드 자체는 쓰지 않으므로 null 로 둔다.
        service = new LoginAttemptService(loginAttemptRepository, userQueryService, authService,
                authSessionService, null, jwtProvider, null);
        // 기본 골격: 서명으로 증명된 subject·sid·gen=0 이 실린 AT, authGeneration=0 인 활성 사용자.
        lenient().when(jwtProvider.extractUserId(TOKEN)).thenReturn(USER_ID);
        lenient().when(jwtProvider.extractSessionId(TOKEN)).thenReturn(SESSION_ID);
        lenient().when(jwtProvider.extractAuthGeneration(TOKEN)).thenReturn(0L);
        lenient().when(userQueryService.getCaller(USER_ID)).thenReturn(User.builder().build());
    }

    @Test
    @DisplayName("AT 가 없으면 관문을 타지 않는다 — 최초 로그인은 원래 AT 가 없다")
    void 토큰없음() {
        assertThatCode(() -> service.gateOptionalSession(null)).doesNotThrowAnyException();
        verify(userQueryService, never()).getCaller(any());
        verify(authSessionService, never()).verifySession(any(), any());
    }

    @Test
    @DisplayName("활성 세션 + 세대 일치면 통과한다 — 게스트 승격의 정상 경로")
    void 활성세션통과() {
        given(authSessionService.verifySession(USER_ID, SESSION_ID))
                .willReturn(Optional.of(AuthSession.builder().id(SESSION_ID).userId(USER_ID).build()));

        assertThatCode(() -> service.gateOptionalSession(TOKEN)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("폐기된 세션의 AT 는 SESSION_NOT_ACTIVE — 서명이 멀쩡해도 승격 자격이 아니다")
    void 폐기된세션() {
        given(authSessionService.verifySession(USER_ID, SESSION_ID))
                .willReturn(Optional.of(AuthSession.builder().id(SESSION_ID).userId(USER_ID)
                        .revokedAt(Instant.now()).build()));

        assertThatThrownBy(() -> service.gateOptionalSession(TOKEN))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
    }

    @Test
    @DisplayName("세션 행이 없거나 남의 것이면 SESSION_NOT_ACTIVE — verifySession 이 비어 온다")
    void 세션없음() {
        given(authSessionService.verifySession(USER_ID, SESSION_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> service.gateOptionalSession(TOKEN))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
    }

    @Test
    @DisplayName("authGeneration 불일치는 SESSION_NOT_ACTIVE — 세션 조회 전에 끊는다")
    void 세대불일치() {
        given(jwtProvider.extractAuthGeneration(TOKEN)).willReturn(1L);

        assertThatThrownBy(() -> service.gateOptionalSession(TOKEN))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
        verify(authSessionService, never()).verifySession(any(), any());
    }

    @Test
    @DisplayName("sid 없는 구 AT 는 SESSION_NOT_ACTIVE — 어느 세션인지 증명할 수 없어 폐기 fence 를 못 건다")
    void sid없음() {
        given(jwtProvider.extractSessionId(TOKEN)).willReturn(null);

        assertThatThrownBy(() -> service.gateOptionalSession(TOKEN))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
        verify(authSessionService, never()).verifySession(any(), any());
    }
}
