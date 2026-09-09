package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * CurrencyLedgerService 단위 테스트 — 세션 보상 서버 지급(currency 폐쇄)의 멱등 계약을 고정한다.
 *
 * <p>핵심: 같은 멱등키의 credit 재호출(세션 저장 재시도·배치 재실행)은 이중 지급 없이 스킵돼야 한다.
 * 그리고 {@code debit} 의 잔액 부족 거절 — 여기가 <b>비어 있었다</b>(GROMO-1656 에서 발견).
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
        given(userQueryService.getTargetWalletForUpdate(USER_ID)).willReturn(wallet);

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
        verify(userQueryService, never()).getTargetWalletForUpdate(any());
        verify(userQueryService, never()).getTargetWallet(any());
        verify(currencyTransactionRepository, never()).save(any());
    }
    // ── debit ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("debit 최초 호출 → 잔액 차감 + 멱등키 실린 원장 기입, true 반환")
    void debitAppliesOnce() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(100).build();
        given(currencyTransactionRepository.existsByIdempotencyKey(REWARD_KEY)).willReturn(false);
        given(userQueryService.getTargetWalletForUpdate(USER_ID)).willReturn(wallet);

        boolean applied = currencyLedgerService.debit(user, CurrencyTransactionType.PURCHASE, 30, REWARD_KEY);

        assertThat(applied).isTrue();
        assertThat(wallet.getBalance()).isEqualTo(70);
        verify(currencyTransactionRepository).save(any(CurrencyTransaction.class));
    }

    @Test
    @DisplayName("잔액 부족 debit → INSUFFICIENT_CURRENCY 로 거절하고 원장에 아무것도 남기지 않는다")
    void debitRejectsWhenBalanceIsShort() {
        // 이 단언이 없으면 «차감은 안 됐는데 조용히 성공으로 보고되는» 변경이 전부 초록으로 통과한다.
        // 실제로 GROMO-1656 에서 예외를 지우는 돌연변이를 넣었을 때 1,943개가 전부 통과했다 —
        // debit 의 부족 경로에 증인이 하나도 없었다.
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(10).build();
        given(currencyTransactionRepository.existsByIdempotencyKey(REWARD_KEY)).willReturn(false);
        given(userQueryService.getTargetWalletForUpdate(USER_ID)).willReturn(wallet);

        assertThatThrownBy(() -> currencyLedgerService.debit(
                user, CurrencyTransactionType.PURCHASE, 30, REWARD_KEY))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.INSUFFICIENT_CURRENCY);

        // 잔액은 손대지 않았고(음수 금지), 원장도 비어 있어야 한다 — 둘 중 하나만 지켜지면 장부가 어긋난다
        assertThat(wallet.getBalance()).isEqualTo(10);
        verify(currencyTransactionRepository, never()).save(any(CurrencyTransaction.class));
    }
}
