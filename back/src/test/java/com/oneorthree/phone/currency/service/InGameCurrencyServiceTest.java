package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.domain.CurrencyReason;
import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.TransactionType;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.currency.service.InGameCurrencyService;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
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
 * InGameCurrencyService 단위 테스트 골격.
 *
 * <p>대상: 잔액 조회, 거래내역 조회, 적립(earn)/사용(spend).
 * 핵심 검증 포인트는 적립/사용 시 reason 유효성(EARN 은 PURCHASE 불가,
 * SPEND 는 PURCHASE 만 허용)과 거래(CurrencyTransaction) 기록 여부.
 */
@ExtendWith(MockitoExtension.class)
class InGameCurrencyServiceTest {

    @InjectMocks
    private InGameCurrencyService inGameCurrencyService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private CurrencyTransactionRepository currencyTransactionRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── getCurrencyBalance ────────────────────────────────────────────────

    @Test
    @DisplayName("잔액 조회 성공 → user.getCurrency() 반환")
    void getCurrencyBalanceSuccess() {
        // given: currency 보유한 User
        User user = User.builder().id(USER_ID).currency(500).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when
        int balance = inGameCurrencyService.getCurrencyBalance(USER_ID);

        // then
        assertThat(balance).isEqualTo(500);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getCurrencyBalanceUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> inGameCurrencyService.getCurrencyBalance(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── getCurrencyTransactions ───────────────────────────────────────────

    @Test
    @DisplayName("거래내역 조회 성공 → 최신순 TransactionsResponse 매핑")
    void getCurrencyTransactionsSuccess() {
        // given: 유저 + 거래 2건 (repository 가 최신순으로 반환한다고 가정)
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        Instant earlier = Instant.parse("2025-12-31T00:00:00Z");
        CurrencyTransaction recent = CurrencyTransaction.builder()
                .user(user).amount(100).type(TransactionType.EARN)
                .reason(CurrencyReason.SESSION_COMPLETE).transactedAt(now).build();
        CurrencyTransaction old = CurrencyTransaction.builder()
                .user(user).amount(50).type(TransactionType.SPEND)
                .reason(CurrencyReason.PURCHASE).transactedAt(earlier).build();
        given(currencyTransactionRepository.findByUserOrderByTransactedAtDesc(user))
                .willReturn(List.of(recent, old));

        // when
        List<TransactionsResponse> responses = inGameCurrencyService.getCurrencyTransactions(USER_ID);

        // then: 순서 유지 + 필드 매핑
        assertThat(responses).hasSize(2);
        assertThat(responses.get(0).getAmount()).isEqualTo(100);
        assertThat(responses.get(0).getType()).isEqualTo(TransactionType.EARN);
        assertThat(responses.get(0).getReason()).isEqualTo(CurrencyReason.SESSION_COMPLETE);
        assertThat(responses.get(0).getTransactedAt()).isEqualTo(now);
        assertThat(responses.get(1).getAmount()).isEqualTo(50);
        assertThat(responses.get(1).getType()).isEqualTo(TransactionType.SPEND);
        assertThat(responses.get(1).getReason()).isEqualTo(CurrencyReason.PURCHASE);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getCurrencyTransactionsUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> inGameCurrencyService.getCurrencyTransactions(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── earnCurrency ──────────────────────────────────────────────────────

    @Test
    @DisplayName("적립 성공 → 잔액 증가 + EARN 거래 저장")
    void earnCurrencySuccess() {
        // given: reason != PURCHASE
        User user = User.builder().id(USER_ID).currency(100).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when
        inGameCurrencyService.earnCurrency(USER_ID, CurrencyReason.SESSION_COMPLETE, 50);

        // then: 잔액 증가 + 저장된 거래의 type/reason/amount 검증
        assertThat(user.getCurrency()).isEqualTo(150);

        ArgumentCaptor<CurrencyTransaction> captor = ArgumentCaptor.forClass(CurrencyTransaction.class);
        verify(currencyTransactionRepository).save(captor.capture());
        CurrencyTransaction saved = captor.getValue();
        assertThat(saved.getType()).isEqualTo(TransactionType.EARN);
        assertThat(saved.getReason()).isEqualTo(CurrencyReason.SESSION_COMPLETE);
        assertThat(saved.getAmount()).isEqualTo(50);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND), save 미호출")
    void earnCurrencyUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyReason.SESSION_COMPLETE, 50))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(currencyTransactionRepository, never()).save(any());
    }

    @Test
    @DisplayName("적립 사유가 PURCHASE → CurrencyException(ILLEGAL_EARN_REASON)")
    void earnCurrencyIllegalReason() {
        // given: reason == PURCHASE
        User user = User.builder().id(USER_ID).currency(100).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when & then: 예외 + 잔액/거래 변화 없음
        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyReason.PURCHASE, 50))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.ILLEGAL_EARN_REASON);
        assertThat(user.getCurrency()).isEqualTo(100);
        verify(currencyTransactionRepository, never()).save(any());
    }

    // ── spendCurrency ─────────────────────────────────────────────────────

    @Test
    @DisplayName("사용 성공 → 잔액 차감 + SPEND 거래 저장")
    void spendCurrencySuccess() {
        // given: 충분한 잔액 + reason == PURCHASE
        User user = User.builder().id(USER_ID).currency(1000).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when
        inGameCurrencyService.spendCurrency(USER_ID, CurrencyReason.PURCHASE, 300);

        // then: 잔액 차감 + 저장된 거래의 type/reason/amount 검증
        assertThat(user.getCurrency()).isEqualTo(700);

        ArgumentCaptor<CurrencyTransaction> captor = ArgumentCaptor.forClass(CurrencyTransaction.class);
        verify(currencyTransactionRepository).save(captor.capture());
        CurrencyTransaction saved = captor.getValue();
        assertThat(saved.getType()).isEqualTo(TransactionType.SPEND);
        assertThat(saved.getReason()).isEqualTo(CurrencyReason.PURCHASE);
        assertThat(saved.getAmount()).isEqualTo(300);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void spendCurrencyUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyReason.PURCHASE, 300))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("사용 사유가 PURCHASE 아님 → CurrencyException(ILLEGAL_SPEND_REASON)")
    void spendCurrencyIllegalReason() {
        // given: reason != PURCHASE
        User user = User.builder().id(USER_ID).currency(1000).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when & then: 예외 + 잔액/거래 변화 없음
        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyReason.SESSION_COMPLETE, 300))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.ILLEGAL_SPEND_REASON);
        assertThat(user.getCurrency()).isEqualTo(1000);
        verify(currencyTransactionRepository, never()).save(any());
    }

    // ── [직접 구현 B] 도메인 엣지케이스 (스켈레톤 누락분) ──────────────────────

    @Test
    @DisplayName("사용 시 잔액 부족 → CurrencyException(INSUFFICIENT_CURRENCY), 거래 미기록")
    void spendCurrencyInsufficientBalance() {
        // given: 잔액 50 인데 PURCHASE 100 시도
        User user = User.builder().id(USER_ID).currency(50).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when & then: User.spendCurrency 내부에서 INSUFFICIENT_CURRENCY
        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyReason.PURCHASE, 100))
                .isInstanceOf(CurrencyException.class)
                .extracting("errorCode")
                .isEqualTo(CurrencyErrorCode.INSUFFICIENT_CURRENCY);
        assertThat(user.getCurrency()).isEqualTo(50);                 // 잔액 그대로
        verify(currencyTransactionRepository, never()).save(any());   // 거래 미기록
    }

    @Test
    @DisplayName("적립 금액이 0 이하 → IllegalArgumentException, 거래 미기록")
    void earnCurrencyNonPositiveAmount() {
        // given: 정상 user + 정상 reason(비 PURCHASE)
        User user = User.builder().id(USER_ID).currency(100).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when & then: amount = 0, -10 둘 다 IllegalArgumentException (User.earnCurrency 의 amount<=0)
        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyReason.SESSION_COMPLETE, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() ->
                inGameCurrencyService.earnCurrency(USER_ID, CurrencyReason.SESSION_COMPLETE, -10))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(user.getCurrency()).isEqualTo(100);               // 잔액 그대로
        verify(currencyTransactionRepository, never()).save(any());  // 거래 미기록
    }

    @Test
    @DisplayName("사용 금액이 0 이하 → IllegalArgumentException (잔액 비교 전에 거부)")
    void spendCurrencyNonPositiveAmount() {
        // given: 정상 user(reason=PURCHASE), 충분한 잔액이어도 금액 자체가 0/음수면 거부
        User user = User.builder().id(USER_ID).currency(1000).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when & then: amount<=0 가 INSUFFICIENT_CURRENCY 검사보다 먼저 터짐
        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyReason.PURCHASE, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() ->
                inGameCurrencyService.spendCurrency(USER_ID, CurrencyReason.PURCHASE, -10))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(user.getCurrency()).isEqualTo(1000);
        verify(currencyTransactionRepository, never()).save(any());
    }
}
