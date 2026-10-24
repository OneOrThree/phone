package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * {@link AuthSessionService#requireActive} 의 술어를 직접 겨누는 단위 테스트 (GROMO-2450).
 *
 * <p>세션 활성 재검사는 이 메서드 하나로 모였다. 호출처 테스트는 {@code requireActive} 를 mock 으로 두므로
 * sid·gen null, 세대 불일치, 세션 행 부재·폐기의 판정은 여기서만 실제로 검증된다. 앞의 세 가지는
 * 세션 행을 잠그기 «전에» 끊어야 하므로 저장소를 건드리지 않는 것까지 고정한다.
 */
@ExtendWith(MockitoExtension.class)
class AuthSessionServiceRequireActiveTest {

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000002450");
    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-000000002451");
    /** 잠근 users 행의 현재 인증 세대 — 호출자가 값으로 넘긴다. */
    private static final long CURRENT_GENERATION = 1L;

    @Mock
    private AuthSessionRepository authSessionRepository;
    @Mock
    private LoginAttemptRepository loginAttemptRepository;
    @Mock
    private OutboxCommandPort outboxCommandPort;

    private AuthSessionService service;

    @BeforeEach
    void setUp() {
        service = new AuthSessionService(authSessionRepository, loginAttemptRepository, outboxCommandPort,
                Clock.fixed(Instant.parse("2026-10-24T00:00:00Z"), ZoneOffset.UTC), false, 3600L);
    }

    @Test
    @DisplayName("sid 가 없으면 SESSION_NOT_ACTIVE — 세션 행을 조회하지 않는다")
    void sid없음() {
        assertThatThrownBy(() -> service.requireActive(USER_ID, CURRENT_GENERATION, null, CURRENT_GENERATION))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
        verifyNoInteractions(authSessionRepository);
    }

    @Test
    @DisplayName("gen 이 없으면 SESSION_NOT_ACTIVE — 세션 행을 조회하지 않는다")
    void gen없음() {
        assertThatThrownBy(() -> service.requireActive(USER_ID, CURRENT_GENERATION, SESSION_ID, null))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
        verifyNoInteractions(authSessionRepository);
    }

    @Test
    @DisplayName("gen 이 현재 세대와 다르면 SESSION_NOT_ACTIVE — 세션 행을 조회하지 않는다")
    void 세대불일치() {
        assertThatThrownBy(() -> service.requireActive(USER_ID, CURRENT_GENERATION, SESSION_ID, 0L))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
        verifyNoInteractions(authSessionRepository);
    }

    @Test
    @DisplayName("sid·gen 이 맞아도 세션 행이 없거나 남의 것이면 SESSION_NOT_ACTIVE")
    void 세션행없음() {
        given(authSessionRepository.findByIdAndUserIdForUpdate(SESSION_ID, USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> service.requireActive(USER_ID, CURRENT_GENERATION, SESSION_ID, CURRENT_GENERATION))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
    }

    @Test
    @DisplayName("sid·gen 이 맞아도 세션이 폐기됐으면 SESSION_NOT_ACTIVE")
    void 폐기된세션() {
        given(authSessionRepository.findByIdAndUserIdForUpdate(SESSION_ID, USER_ID))
                .willReturn(Optional.of(AuthSession.builder().id(SESSION_ID).userId(USER_ID)
                        .revokedAt(Instant.now()).build()));

        assertThatThrownBy(() -> service.requireActive(USER_ID, CURRENT_GENERATION, SESSION_ID, CURRENT_GENERATION))
                .isInstanceOf(AuthException.class)
                .hasFieldOrPropertyWithValue("errorCode", AuthErrorCode.SESSION_NOT_ACTIVE);
    }

    @Test
    @DisplayName("활성 세션 + 세대 일치면 통과한다 — 세션 행을 (sessionId, userId) 로 정확히 한 번 잠근다")
    void 활성세션통과() {
        given(authSessionRepository.findByIdAndUserIdForUpdate(SESSION_ID, USER_ID))
                .willReturn(Optional.of(AuthSession.builder().id(SESSION_ID).userId(USER_ID).build()));

        assertThatCode(() -> service.requireActive(USER_ID, CURRENT_GENERATION, SESSION_ID, CURRENT_GENERATION))
                .doesNotThrowAnyException();
        verify(authSessionRepository, times(1)).findByIdAndUserIdForUpdate(SESSION_ID, USER_ID);
    }
}
