package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버가 금액을 결정하는 재화 변동 전용 원장 서비스.
 *
 * <p>클라 요청을 그대로 반영하는 {@link InGameCurrencyService} 와 분리한 이유:
 * 그쪽은 "earn 은 PURCHASE 불가 / spend 는 PURCHASE 만"이라는 <b>클라 신뢰 전제</b>의 검증을 걸고
 * 있어 서버 주도 타입(BET_*)이 통과할 수 없다. 이 서비스는 호출자가 서버 로직이라는 전제 아래
 * 타입 제약 대신 <b>멱등키</b>로 안전성을 확보한다.
 *
 * <p>멱등키는 {@code currency_transactions.idempotency_key} 유니크 제약이 최후 방어선이고,
 * 여기서는 그 앞단에서 조회해 "이미 적용됨"이면 조용히 스킵한다 — 정산 배치 재실행이 정상 흐름이라
 * 예외로 다룰 일이 아니기 때문이다. 지갑 변경과 원장 기입은 호출자의 트랜잭션에 함께 묶인다
 * (전파 REQUIRED) — 한쪽만 남는 상태가 생기지 않는다.
 *
 * <p>{@code amount} 는 항상 양수(절대값)로 기입한다 — 방향은 type 이 표현하며, 기존
 * {@link InGameCurrencyService} 의 기입 관행과 같다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CurrencyLedgerService {

    private final UserWalletRepository userWalletRepository;
    private final CurrencyTransactionRepository currencyTransactionRepository;

    /**
     * 잔액 차감 + 원장 기입. 잔액 부족이면 {@code INSUFFICIENT_CURRENCY}
     * ({@link UserWallet#spend(int)} 가 던진다).
     *
     * @return 이번 호출로 실제 반영됐으면 true, 멱등키가 이미 있어 스킵했으면 false
     */
    @Transactional
    public boolean debit(User user, CurrencyTransactionType type, int amount, String idempotencyKey) {
        if (alreadyApplied(type, idempotencyKey)) {
            return false;
        }
        wallet(user).spend(amount);
        record(user, type, amount, idempotencyKey);
        return true;
    }

    /**
     * 잔액 지급 + 원장 기입.
     *
     * @return 이번 호출로 실제 반영됐으면 true, 멱등키가 이미 있어 스킵했으면 false
     */
    @Transactional
    public boolean credit(User user, CurrencyTransactionType type, int amount, String idempotencyKey) {
        if (alreadyApplied(type, idempotencyKey)) {
            return false;
        }
        wallet(user).earn(amount);
        record(user, type, amount, idempotencyKey);
        return true;
    }

    private boolean alreadyApplied(CurrencyTransactionType type, String idempotencyKey) {
        if (!currencyTransactionRepository.existsByIdempotencyKey(idempotencyKey)) {
            return false;
        }
        log.info("재화 변동 스킵 — 멱등키 선점됨. type={}, idempotencyKey={}", type, idempotencyKey);
        return true;
    }

    private UserWallet wallet(User user) {
        return userWalletRepository.findById(user.getId())
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    private void record(User user, CurrencyTransactionType type, int amount, String idempotencyKey) {
        currencyTransactionRepository.save(CurrencyTransaction.builder()
                .user(user)
                .amount(amount)
                .type(type)
                .idempotencyKey(idempotencyKey)
                .build());
    }
}
