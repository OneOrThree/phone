package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class InGameCurrencyService {

    private final UserRepository userRepository;
    private final UserWalletRepository userWalletRepository;
    private final CurrencyTransactionRepository currencyTransactionRepository;

    public int getCurrencyBalance(UUID userId) {
        return userWalletRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND))
                .getBalance();
    }

    /*
    @todo 페이지네이션 필요함 나중에
     */
    public List<TransactionsResponse> getCurrencyTransactions(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user)
                .stream()
                .map(transaction -> new TransactionsResponse(transaction.getAmount(),
                        transaction.getType(), transaction.getCreatedAt()))
                .toList();
    }

    @Transactional
    public void earnCurrency(UUID userId, CurrencyTransactionType type, int amount) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 서버 전용 타입(BET_*)은 클라가 실어 보낼 수 없다 — 통과시키면 임의 금액 발행이 되고,
        // 원장에서 정산 기입과 구분되지 않아 에스크로·지급 정합 검증이 불가능해진다.
        if (type == CurrencyTransactionType.PURCHASE || type.isServerOnly()) {
            throw new CurrencyException(CurrencyErrorCode.ILLEGAL_EARN_REASON);
        }

        UserWallet wallet = userWalletRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        wallet.earn(amount);
        currencyTransactionRepository.save(CurrencyTransaction.builder()
                .user(user)
                .amount(amount)
                .type(type)
                .build());
    }

    @Transactional
    public void spendCurrency(UUID userId, CurrencyTransactionType type, int amount) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (type != CurrencyTransactionType.PURCHASE) {
            throw new CurrencyException(CurrencyErrorCode.ILLEGAL_SPEND_REASON);
        }

        UserWallet wallet = userWalletRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        wallet.spend(amount);
        currencyTransactionRepository.save(CurrencyTransaction.builder()
                .user(user)
                .amount(amount)
                .type(type)
                .build());
    }
}
