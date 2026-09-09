package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * InGameCurrencyService 단위 테스트. 잔액은 UserWallet로 분리됨.
 */
@ExtendWith(MockitoExtension.class)
class InGameCurrencyServiceTest {

    @InjectMocks
    private InGameCurrencyService inGameCurrencyService;

    @Mock
    private UserQueryService userQueryService;

    @Mock
    private CurrencyTransactionRepository currencyTransactionRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── getCurrencyBalance ────────────────────────────────────────────────

    @Test
    @DisplayName("잔액 조회 성공 → wallet.getBalance() 반환")
    void getCurrencyBalanceSuccess() {
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(500).build();
        given(userQueryService.getWallet(USER_ID)).willReturn(wallet);

        int balance = inGameCurrencyService.getCurrencyBalance(USER_ID);

        assertThat(balance).isEqualTo(500);
    }

    @Test
    @DisplayName("지갑 없음 → UserException(NOT_FOUND)")
    void getCurrencyBalanceUserNotFound() {
        given(userQueryService.getWallet(USER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> inGameCurrencyService.getCurrencyBalance(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── getCurrencyTransactions ───────────────────────────────────────────

    @Test
    @DisplayName("거래내역 조회 성공 → 최신순 TransactionsResponse 매핑")
    void getCurrencyTransactionsSuccess() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(user);

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
        given(userQueryService.getCaller(USER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> inGameCurrencyService.getCurrencyTransactions(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── earnCurrency (currency 폐쇄 — no-op) ──────────────────────────────

    @Test
    @DisplayName("적립은 no-op — 어떤 타입·금액이어도 잔액·원장 무변화, 예외 없음(구앱 fire-and-forget 호환)")
    void earnCurrencyIsNoOp() {
        // 클라 주도 적립은 코인 민팅 악용 벡터라 폐쇄됐다. 세션 보상은 세션 저장에서 서버가 직접 지급하므로
        // 여기서는 서버 전용(BET_*)·PURCHASE·음수 금액까지 전부 조용히 무시돼야 한다(로그만).
        for (CurrencyTransactionType type : CurrencyTransactionType.values()) {
            inGameCurrencyService.earnCurrency(USER_ID, type, 1_000);
        }
        inGameCurrencyService.earnCurrency(USER_ID, CurrencyTransactionType.SESSION_COMPLETE, 0);
        inGameCurrencyService.earnCurrency(USER_ID, CurrencyTransactionType.SESSION_COMPLETE, -10);

        verify(currencyTransactionRepository, never()).save(any());
        // 유저 조회도 지갑 조회도 일어나지 않는다 — 두 진입점이 userQueryService 한 곳으로 접혔으므로
        // 상호작용 0 단언이 옛 verify(userWalletRepository, never()).findById(...) 까지 함께 덮는다.
        verifyNoInteractions(userQueryService);
    }

    @Test
    @DisplayName("사용 사유가 서버 전용(BET_*) → CurrencyException(ILLEGAL_SPEND_REASON)")
    void spendCurrencyRejectsServerOnlyTypes() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);

        // spend 는 PURCHASE 만 허용하므로 BET_* 는 원래 걸리지만, 그 성질을 테스트로 못 박아 둔다.
        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.BET_STAKE, 30))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.ILLEGAL_SPEND_REASON);
        verify(currencyTransactionRepository, never()).save(any());
    }

    // ── spendCurrency ─────────────────────────────────────────────────────

    @Test
    @DisplayName("사용 성공 → wallet 잔액 차감 + PURCHASE 거래 저장 — 요청자는 공유 락 활성 조회 (GROMO-1237)")
    void spendCurrencySuccess() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(1000).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(userQueryService.getWallet(USER_ID)).willReturn(wallet);

        inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 300);

        assertThat(wallet.getBalance()).isEqualTo(700);
        // 락 규율 (GROMO-1237): 돈이 움직이는 변경 트랜잭션은 공유 락 활성 조회 — 무락·무필터 getAny 금지.
        verify(userQueryService).getCallerForShare(USER_ID);
        verify(userQueryService, never()).getAny(USER_ID);

        ArgumentCaptor<CurrencyTransaction> captor = ArgumentCaptor.forClass(CurrencyTransaction.class);
        verify(currencyTransactionRepository).save(captor.capture());
        CurrencyTransaction saved = captor.getValue();
        assertThat(saved.getType()).isEqualTo(CurrencyTransactionType.PURCHASE);
        assertThat(saved.getAmount()).isEqualTo(300);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void spendCurrencyUserNotFound() {
        given(userQueryService.getCallerForShare(USER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 300))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("사용 사유가 PURCHASE 아님 → CurrencyException(ILLEGAL_SPEND_REASON)")
    void spendCurrencyIllegalReason() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);

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
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(userQueryService.getWallet(USER_ID)).willReturn(wallet);

        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyTransactionType.PURCHASE, 100))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.INSUFFICIENT_CURRENCY);
        assertThat(wallet.getBalance()).isEqualTo(50);
        verify(currencyTransactionRepository, never()).save(any());
    }

    @Test
    @DisplayName("사용 금액이 0 이하 → IllegalArgumentException (잔액 비교 전에 거부)")
    void spendCurrencyNonPositiveAmount() {
        User user = User.builder().id(USER_ID).build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(1000).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(userQueryService.getWallet(USER_ID)).willReturn(wallet);

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
