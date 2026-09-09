package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserQueryService;
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
 *
 * <p><b>잠금 규율</b>: 잔액을 <b>바꾸는</b> {@link #debit}/{@link #credit} 만 지갑 행을 배타 락으로
 * 잡고({@link UserQueryService#getTargetWalletForUpdate}), 표시용 {@link #balanceOf} 는 락 없이 읽는다.
 * 여러 지갑을 한 트랜잭션에서 만지는 경로(내기 지급·다회차 환불)는 <b>userId 오름차순</b>으로만
 * 접근해야 한다 — 순서가 갈리면 이 배타 락이 곧바로 교착이 된다(계약 §3).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CurrencyLedgerService {

    private final UserQueryService userQueryService;
    private final CurrencyTransactionRepository currencyTransactionRepository;

    /**
     * 잔액 차감 + 원장 기입. 잔액 부족이면 {@code INSUFFICIENT_CURRENCY}
     * ({@link UserWallet#trySpend(int)} 가 거절하면 여기서 던진다).
     *
     * <p>차감과 기입은 호출자의 트랜잭션에 함께 묶이므로 한쪽만 남는 상태가 생기지 않고,
     * 잔액 부족으로 예외가 나면 원장에도 아무 줄이 남지 않는다.
     *
     * @param user           차감 대상. 지갑 행을 배타 락으로 잡으므로 여러 유저를 한 트랜잭션에서
     *                       다룰 때는 userId 오름차순으로 호출해야 교착이 나지 않는다
     * @param type           변동 사유. 방향은 이 메서드가 정하므로 type 은 이유만 표현한다
     * @param amount         차감할 금액(양수). 원장에도 이 값이 그대로 양수로 기입된다
     * @param idempotencyKey 같은 정산의 재실행을 구분하는 키
     * @return 이번 호출로 실제 반영됐으면 true, 멱등키가 이미 있어 스킵했으면 false
     */
    @Transactional
    public boolean debit(User user, CurrencyTransactionType type, int amount, String idempotencyKey) {
        if (alreadyApplied(type, idempotencyKey)) {
            return false;
        }
        if (!walletForUpdate(user).trySpend(amount)) {
            // 잔액 부족을 어떤 실패로 보고할지는 재화 도메인이 정한다 (GROMO-1656) —
            // 지갑 엔티티는 「모자란다」는 사실만 알린다. 응답은 종전과 같은 400 INSUFFICIENT_CURRENCY 다.
            throw new CurrencyException(CurrencyErrorCode.INSUFFICIENT_CURRENCY);
        }
        record(user, type, amount, idempotencyKey);
        return true;
    }

    /**
     * 잔액 지급 + 원장 기입.
     *
     * <p>지급과 기입은 호출자의 트랜잭션에 함께 묶인다 — 지급만 되고 원장이 비는 일은 없다.
     *
     * @param user           지급 대상. 지갑 행을 배타 락으로 잡으므로 여러 유저를 한 트랜잭션에서
     *                       다룰 때는 userId 오름차순으로 호출해야 교착이 나지 않는다
     * @param type           변동 사유. 방향은 이 메서드가 정하므로 type 은 이유만 표현한다
     * @param amount         지급할 금액(양수)
     * @param idempotencyKey 같은 정산의 재실행을 구분하는 키
     * @return 이번 호출로 실제 반영됐으면 true, 멱등키가 이미 있어 스킵했으면 false
     */
    @Transactional
    public boolean credit(User user, CurrencyTransactionType type, int amount, String idempotencyKey) {
        if (alreadyApplied(type, idempotencyKey)) {
            return false;
        }
        walletForUpdate(user).earn(amount);
        record(user, type, amount, idempotencyKey);
        return true;
    }

    /**
     * 현재 잔액. 세션 저장 응답의 balanceAfter(구 번들 호환 필드)를 채우는 데 쓴다 — 현재 앱은
     * 잔액을 GET /currency 재조회로 받으므로 신규 소비처를 늘리지 않는다.
     *
     * @param user 조회 대상
     * @return 지갑 행의 잔액. 락 없이 읽으므로 같은 트랜잭션 밖의 동시 차감·지급이 곧바로 반영되지는 않는다
     */
    public int balanceOf(User user) {
        return wallet(user).getBalance();
    }

    private boolean alreadyApplied(CurrencyTransactionType type, String idempotencyKey) {
        if (!currencyTransactionRepository.existsByIdempotencyKey(idempotencyKey)) {
            return false;
        }
        log.info("재화 변동 스킵 — 멱등키 선점됨. type={}, idempotencyKey={}", type, idempotencyKey);
        return true;
    }

    /**
     * 잔액을 바꾸기 직전의 지갑 로드 — <b>행 배타 락</b>을 잡는다
     * ({@link UserQueryService#getTargetWalletForUpdate} → {@code UserWalletRepository.findByIdForUpdate}).
     *
     * <p>낙관락만으로는 같은 지갑에 동시에 들어온 두 트랜잭션 중 늦은 쪽이 0행 갱신으로 터져
     * <b>트랜잭션 전체가 롤백</b>된다 — 챌린지 삭제처럼 한 트랜잭션이 여러 참가자의 환불을 묶어
     * 처리하는 경로에서는 삭제·환불이 통째로 실패했다. 비관 락이면 늦은 쪽이 기다렸다 진행한다.
     * 지갑을 여러 개 잡는 경로는 전부 userId 오름차순이라 대기 사슬이 순환하지 않는다(계약 §3).
     */
    private UserWallet walletForUpdate(User user) {
        return userQueryService.getTargetWalletForUpdate(user.getId());
    }

    /** 표시용 잔액 로드 — <b>락 없음</b>. 순수 조회가 배타 락을 잡으면 무관한 결제·정산이 막힌다. */
    private UserWallet wallet(User user) {
        return userQueryService.getTargetWallet(user.getId());
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
