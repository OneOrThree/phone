package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.repository.LoginAttemptRepository;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.internal.dto.LoginAttemptExecuteRequest;
import com.oneorthree.phone.internal.dto.LoginSessionResponse;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 「확인 후 계정 전환」의 조합 판정 (GROMO-1994 · 정책 「인증·게스트 계정」).
 *
 * <p>이 클래스가 고정하는 것은 딱 하나 — <b>언제 게스트를 폐기하고 선택 AT 를 버리는가</b>.
 * 세 입력의 조합이 결말을 가르고, 그중 하나만 틀려도 되돌릴 수 없는 사고가 난다:
 * <ul>
 *   <li>확인했는데 충돌이 «없는» 요청을 전환으로 처리하면 → 게스트 데이터를 버리고 빈 신규 계정을 만든다</li>
 *   <li>확인하지 «않은» 요청을 전환으로 처리하면 → 동의 없이 파기한다</li>
 *   <li>전환인데 선택 AT 를 계속 넘기면 → 탈퇴가 방금 올린 authGeneration 때문에 401 이 된다</li>
 * </ul>
 *
 * <p>제공자 검증은 {@code verifyProviderId} 한 번뿐이라는 것도 같이 고정한다 — 전환 분기가
 * 어댑터를 다시 부르면 일회성 자격에서 두 번째 교환이 실패한다.
 */
@ExtendWith(MockitoExtension.class)
class LoginAttemptServiceAccountSwitchTest {

    private static final UUID ATTEMPT = UUID.fromString("00000000-0000-0000-0000-000000001994");
    private static final UUID GUEST = UUID.fromString("00000000-0000-0000-0000-0000000019a0");
    private static final String TOKEN = "guest-access-token";
    private static final String PROVIDER_ID = "apple-subject-1";

    @Mock
    private LoginAttemptRepository loginAttemptRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private AuthService authService;
    @Mock
    private AuthSessionService authSessionService;
    @Mock
    private AccountWithdrawalService accountWithdrawalService;
    @Mock
    private JwtProvider jwtProvider;
    @Mock
    private LoginAttemptService self;

    private LoginAttemptService service;

    @BeforeEach
    void setUp() {
        service = new LoginAttemptService(loginAttemptRepository, userQueryService, authService,
                authSessionService, accountWithdrawalService, jwtProvider, null, self);
        lenient().when(self.claim(any())).thenReturn(null);
        lenient().when(self.complete(any(), any()))
                .thenReturn(new LoginSessionResponse("at", "rt", UUID.randomUUID(), true, "bootstrap"));
        lenient().when(authService.verifyProviderId(Provider.APPLE, "credential")).thenReturn(PROVIDER_ID);
        lenient().when(jwtProvider.extractUserId(TOKEN)).thenReturn(GUEST);
        lenient().when(authService.loginWithProviderId(any(), any(), any()))
                .thenReturn(new SocialLoginResponse("at", "rt", false, "bootstrap", UUID.randomUUID()));
    }

    @Test
    @DisplayName("확인 + 실제 충돌 + 활성 게스트 → 게스트를 폐기하고 선택 AT 없이 대상 계정으로 로그인한다")
    void confirmedConflictDiscardsGuestAndLogsIntoLinkedAccount() {
        given(authService.isLinkedToAnotherUser(Provider.APPLE, PROVIDER_ID, GUEST)).willReturn(true);
        given(userQueryService.findActive(GUEST)).willReturn(Optional.of(guestRow()));

        service.execute(request(true));

        verify(accountWithdrawalService).withdraw(GUEST);
        // 선택 AT 를 넘기지 «않는다» — 탈퇴가 그 세션을 폐기하고 세대를 올렸으므로 넘기면 자기 상태에 걸린다.
        verify(authService).loginWithProviderId(Provider.APPLE, PROVIDER_ID, null);
        verify(authService).verifyProviderId(Provider.APPLE, "credential");
    }

    @Test
    @DisplayName("확인했지만 충돌이 없으면 전환이 아니다 — 폐기하지 않고 선택 AT 로 평소 승격을 탄다")
    void confirmedWithoutConflictStaysOnThePromotionPath() {
        given(authService.isLinkedToAnotherUser(Provider.APPLE, PROVIDER_ID, GUEST)).willReturn(false);

        service.execute(request(true));

        verify(accountWithdrawalService, never()).withdraw(any());
        verify(authService).loginWithProviderId(Provider.APPLE, PROVIDER_ID, "Bearer " + TOKEN);
    }

    @Test
    @DisplayName("확인하지 않은 충돌은 건드리지 않는다 — 선택 AT 를 넘겨 기존 409 거절이 나오게 둔다")
    void unconfirmedConflictIsLeftToTheExistingRejection() {
        service.execute(request(false));

        verify(accountWithdrawalService, never()).withdraw(any());
        verify(authService, never()).isLinkedToAnotherUser(any(), any(), any());
        verify(authService).loginWithProviderId(Provider.APPLE, PROVIDER_ID, "Bearer " + TOKEN);
    }

    @Test
    @DisplayName("이미 탈퇴한 게스트로 재개하면 폐기를 건너뛰고 로그인만 이어 한다 — 두 번째 탈퇴로 404 가 되지 않는다")
    void resumeAfterWithdrawalSkipsTheDiscard() {
        given(authService.isLinkedToAnotherUser(Provider.APPLE, PROVIDER_ID, GUEST)).willReturn(true);
        given(userQueryService.findActive(GUEST)).willReturn(Optional.empty());

        service.execute(request(true));

        verify(accountWithdrawalService, never()).withdraw(any());
        verify(authService).loginWithProviderId(Provider.APPLE, PROVIDER_ID, null);
    }

    private static User guestRow() {
        return User.builder().id(GUEST).isGuest(true).build();
    }

    private static LoginAttemptExecuteRequest request(boolean confirmed) {
        return new LoginAttemptExecuteRequest(ATTEMPT, "key-1", "digest-1", Provider.APPLE,
                "id_token", "credential", "2026-09", TOKEN, confirmed);
    }
}
