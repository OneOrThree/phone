package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * InGameCurrencyService 단위 테스트. 잔액은 UserWallet로 분리됨.
 */
@ExtendWith(MockitoExtension.class)
class InGameCurrencyServiceTest {

    @InjectMocks
    private InGameCurrencyService inGameCurrencyService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserWalletRepository userWalletRepository;

    @Mock
    private CurrencyTransactionRepository currencyTransactionRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── getCurrencyBalance ────────────────────────────────────────────────

    @Test
    @DisplayName("잔액 조회 성공 → wallet.getBalance() 반환")
    void getCurrencyBalanceSuccess() {
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(500).build();
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));

        int balance = inGameCurrencyService.getCurrencyBalance(USER_ID);

        assertThat(balance).isEqualTo(500);
    }

    @Test
    @DisplayName("지갑 없음 → UserException(NOT_FOUND)")
    void getCurrencyBalanceUserNotFound() {
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> inGameCurrencyService.getCurrencyBalance(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── getCurrencyTransactions ───────────────────────────────────────────

    @Test
    @DisplayName("거래내역 조회 성공 → 최신순 TransactionsResponse 매핑")
    void getCurrencyTransactionsSuccess() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        Instant earlier = Instant.parse("2025-12-31T00:00:00Z");
        CurrencyTransaction recent = CurrencyTransaction.builder()
                .user(user).amount(100).type(CurrencyTransactionType.SESSION_COMPLETE)
                .createdAt(now).build();
        CurrencyTransaction old = CurrencyTransaction.builder()
                .user(user).amount(50).type(CurrencyTransactionType.PURCHASE)
                .createdAt(earlier).build();
        given(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user))
                .willReturn(List.of(recent, old));

        List<TransactionsResponse> responses = inGameCurrencyService.getCurrencyTransactions(USER_ID);

        assertThat(responses).hasSize(2);
        assertThat(responses.get(0).getAmount()).isEqualTo(100);
        assertThat(responses.get(0).getType()).isEqualTo(CurrencyTransactionType.SESSION_COMPLETE);
        assertThat(responses.get(0).getCreatedAt()).isEqualTo(now);
        assertThat(responses.get(1).getAmount()).isEqualTo(50);
        assertThat(responses.get(1).getType()).isEqualTo(CurrencyTransactionType.PURCHASE);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getCurrencyTransactionsUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> inGameCurrencyService.getCurrencyTransactions(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── earnCurrency ──────────────────────────────────────────────────────

    @Test
    @DisplayName("적립 성공 → wallet 잔액 증가 + SESSION_COMPLETE 거래 저장")
    void earnCurrencySuccess() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(100).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));

        inGameCurrencyService.earnCurrency(USER_ID, CurrencyTransactionType.SESSION_COMPLETE, 50);

        assertThat(wallet.getBalance()).isEqualTo(150);

        ArgumentCaptor<CurrencyTransaction> captor = ArgumentCaptor.forClass(CurrencyTransaction.class);
        verify(currencyTransactionRepository).save(captor.capture());
        CurrencyTransaction saved = captor.getValue();
        assertThat(saved.getType()).isEqualTo(CurrencyTransactionType.SESSION_COMPLETE);
        assertThat(saved.getAmount()).isEqualTo(50);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND), save 미호출")
    void earnCurrencyUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyTransactionType.SESSION_COMPLETE, 50))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(currencyTransactionRepository, never()).save(any());
    }

    @Test
    @DisplayName("적립 사유가 PURCHASE → CurrencyException(ILLEGAL_EARN_REASON)")
    void earnCurrencyIllegalReason() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 50))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.ILLEGAL_EARN_REASON);
        verify(currencyTransactionRepository, never()).save(any());
    }

    // ── spendCurrency ─────────────────────────────────────────────────────

    @Test
    @DisplayName("사용 성공 → wallet 잔액 차감 + PURCHASE 거래 저장")
    void spendCurrencySuccess() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(1000).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));

        inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 300);

        assertThat(wallet.getBalance()).isEqualTo(700);

        ArgumentCaptor<CurrencyTransaction> captor = ArgumentCaptor.forClass(CurrencyTransaction.class);
        verify(currencyTransactionRepository).save(captor.capture());
        CurrencyTransaction saved = captor.getValue();
        assertThat(saved.getType()).isEqualTo(CurrencyTransactionType.PURCHASE);
        assertThat(saved.getAmount()).isEqualTo(300);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void spendCurrencyUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 300))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("사용 사유가 PURCHASE 아님 → CurrencyException(ILLEGAL_SPEND_REASON)")
    void spendCurrencyIllegalReason() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.SESSION_COMPLETE, 300))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.ILLEGAL_SPEND_REASON);
        verify(currencyTransactionRepository, never()).save(any());
    }

    // ── 도메인 엣지케이스 ──────────────────────────────────────────────────

    @Test
    @DisplayName("사용 시 잔액 부족 → CurrencyException(INSUFFICIENT_CURRENCY), 거래 미기록")
    void spendCurrencyInsufficientBalance() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(50).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));

        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 100))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.INSUFFICIENT_CURRENCY);
        assertThat(wallet.getBalance()).isEqualTo(50);
        verify(currencyTransactionRepository, never()).save(any());
    }

    @Test
    @DisplayName("적립 금액이 0 이하 → IllegalArgumentException, 거래 미기록")
    void earnCurrencyNonPositiveAmount() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(100).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));

        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyTransactionType.SESSION_COMPLETE, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyTransactionType.SESSION_COMPLETE, -10))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(wallet.getBalance()).isEqualTo(100);
        verify(currencyTransactionRepository, never()).save(any());
    }

    @Test
    @DisplayName("사용 금액이 0 이하 → IllegalArgumentException (잔액 비교 전에 거부)")
    void spendCurrencyNonPositiveAmount() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(1000).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));

        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, -10))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(wallet.getBalance()).isEqualTo(1000);
        verify(currencyTransactionRepository, never()).save(any());
    }
}
