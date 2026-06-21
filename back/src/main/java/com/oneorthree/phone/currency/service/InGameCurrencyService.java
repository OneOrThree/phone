package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.domain.CurrencyReason;
import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.TransactionType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class InGameCurrencyService {

    private final UserRepository userRepository;
    private final CurrencyTransactionRepository currencyTransactionRepository;

    public int getCurrencyBalance(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return user.getCurrency();
    }

    /*
    @todo 페이지네이션 필요함 나중에
     */
    public List<TransactionsResponse> getCurrencyTransactions(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return currencyTransactionRepository.findByUserOrderByTransactedAtDesc(user)
                .stream()
                .map(transaction -> new TransactionsResponse(transaction.getAmount(),
                        transaction.getType(), transaction.getReason(), transaction.getTransactedAt()))
                .toList();
    }

    @Transactional
    public void earnCurrency(Long userId, CurrencyReason reason, int amount) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (reason == CurrencyReason.PURCHASE) {
            throw new CurrencyException(CurrencyErrorCode.ILLEGAL_EARN_REASON);
        }

        user.earnCurrency(amount);
        currencyTransactionRepository.save(CurrencyTransaction.builder()
                .user(user)
                .amount(amount)
                .type(TransactionType.EARN)
                .reason(reason)
                .build());
    }

    @Transactional
    public void spendCurrency(Long userId, CurrencyReason reason, int amount) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (reason != CurrencyReason.PURCHASE) {
            throw new CurrencyException(CurrencyErrorCode.ILLEGAL_SPEND_REASON);
        }

        user.spendCurrency(amount);
        currencyTransactionRepository.save(CurrencyTransaction.builder()
                .user(user)
                .amount(amount)
                .type(TransactionType.SPEND)
                .reason(reason)
                .build());
    }
}
