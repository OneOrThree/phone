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
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Slf4j
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
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user)
                .stream()
                .map(transaction -> new TransactionsResponse(transaction.getAmount(),
                        transaction.getType(), transaction.getCreatedAt()))
                .toList();
    }

    /**
     * currency 폐쇄(서버 지급 전환) — {@code /currency/earn} 은 no-op 이다.
     *
     * <p>클라가 금액을 정하는 적립 개방은 내기 코인 민팅 악용 벡터라 폐쇄했다. 세션 보상은 세션 저장
     * (POST /focus-session)에서 서버가 직접 지급한다({@code FocusService} → {@link CurrencyLedgerService} credit).
     * 구앱은 여전히 이 API 를 fire-and-forget 으로 호출하므로 204 를 유지하되 아무것도 반영하지 않는다
     * — 구앱: 저장 시 서버 지급 + earn no-op / 신앱: 저장 시 서버 지급 + earn 미호출 → 어느 조합도 정확히 1회.
     * 호출 잔존 모니터링용으로 log.info 만 남긴다(전량 소멸 확인 후 API 제거 판단).
     */
    public void earnCurrency(UUID userId, CurrencyTransactionType type, int amount) {
        log.info("/currency/earn no-op — 클라 적립 폐쇄(세션 보상은 서버 지급). userId={}, type={}, amount={}",
                userId, type, amount);
    }

    @Transactional
    public void spendCurrency(UUID userId, CurrencyTransactionType type, int amount) {
        User user = requireActiveUser(userId);

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

    /**
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1237) — 지갑 차감·원장 기입처럼 users 행은
     * <b>읽기만 하고</b> 돈을 움직이는 변경 트랜잭션의 요청자 로드. 락 없는 findById 는 계정 탈퇴
     * (UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아 탈퇴의 정리 스캔 이후·커밋 이전에
     * 낀 변경이 유령(탈퇴자 명의 원장 행)으로 남는다. 공유 락끼리는 충돌하지 않아 동시 요청은
     * 그대로 병렬이고, 탈퇴가 먼저 커밋되면 READ COMMITTED 재평가로 빈 결과 → NOT_FOUND(404).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }
}
