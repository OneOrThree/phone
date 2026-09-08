package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * CurrencyLedgerService 단위 테스트 — 세션 보상 서버 지급(currency 폐쇄)의 멱등 계약을 고정한다.
 *
 * <p>핵심: 같은 멱등키의 credit 재호출(세션 저장 재시도·배치 재실행)은 이중 지급 없이 스킵돼야 한다.
 */
@ExtendWith(MockitoExtension.class)
class CurrencyLedgerServiceTest {

    @InjectMocks
    private CurrencyLedgerService currencyLedgerService;

    @Mock
    private UserQueryService userQueryService;

    @Mock
    private CurrencyTransactionRepository currencyTransactionRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final String REWARD_KEY = "focus:00000000-0000-0000-0000-0000000000f1:reward";

    @Test
    @DisplayName("credit 최초 호출 → 잔액 증가 + 멱등키 실린 원장 기입, true 반환")
    void creditAppliesOnce() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(100).build();
        given(currencyTransactionRepository.existsByIdempotencyKey(REWARD_KEY)).willReturn(false);
        // 잔액 변경 경로는 배타 락 조회를 쓴다 — 표시용 getWallet 이 아니다(동시 변경 롤백 방지).
        given(userQueryService.getWalletForUpdate(USER_ID)).willReturn(wallet);

        boolean applied = currencyLedgerService.credit(user, CurrencyTransactionType.SESSION_COMPLETE,
                357, REWARD_KEY);

        assertThat(applied).isTrue();
        assertThat(wallet.getBalance()).isEqualTo(457);
        ArgumentCaptor<CurrencyTransaction> captor = ArgumentCaptor.forClass(CurrencyTransaction.class);
        verify(currencyTransactionRepository).save(captor.capture());
        assertThat(captor.getValue().getType()).isEqualTo(CurrencyTransactionType.SESSION_COMPLETE);
        assertThat(captor.getValue().getAmount()).isEqualTo(357);
        assertThat(captor.getValue().getIdempotencyKey()).isEqualTo(REWARD_KEY);
    }

    @Test
    @DisplayName("같은 멱등키 credit 재호출 → 이중 지급 없음(잔액·원장 무변화), false 반환")
    void creditSkipsWhenIdempotencyKeyAlreadyApplied() {
        User user = User.builder().id(USER_ID).build();
        given(currencyTransactionRepository.existsByIdempotencyKey(REWARD_KEY)).willReturn(true);

        boolean applied = currencyLedgerService.credit(user, CurrencyTransactionType.SESSION_COMPLETE,
                357, REWARD_KEY);

        assertThat(applied).isFalse();
        // 멱등키 선점이면 지갑 행을 잠그지도 않는다 — 불필요한 락으로 남의 결제를 막지 않는다.
        verify(userQueryService, never()).getWalletForUpdate(any());
        verify(userQueryService, never()).getWallet(any());
        verify(currencyTransactionRepository, never()).save(any());
    }
}
