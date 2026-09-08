package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * 클라 요청으로 들어오는 재화 조회·차감을 다루는 서비스.
 *
 * <p>서버가 금액을 정하는 변동은 여기가 아니라 {@link CurrencyLedgerService} 를 탄다.
 * 이쪽은 클라를 믿지 않는다는 전제라 사유 화이트리스트(차감은 PURCHASE 만)를 걸고,
 * 적립은 아예 폐쇄해 두었다 — 클라가 금액을 정하는 적립은 곧 임의 발행이기 때문이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class InGameCurrencyService {

    private final UserQueryService userQueryService;
    private final CurrencyTransactionRepository currencyTransactionRepository;

    /**
     * 지갑 잔액을 읽는다.
     *
     * @param userId 조회 대상. 지갑 행이 없으면 NOT_FOUND(404)
     * @return 지갑에 적힌 잔액. 원장을 다시 합산하지는 않는다
     */
    public int getCurrencyBalance(UUID userId) {
        return userQueryService.getWallet(userId).getBalance();
    }

    /*
    @todo 페이지네이션 필요함 나중에
     */
    /**
     * 재화 변동 원장을 최신순으로 읽는다.
     *
     * @param userId 조회 대상. 탈퇴했거나 없는 유저면 NOT_FOUND(404)
     * @return 원장 전체. 페이지네이션이 없어 기입이 쌓인 유저일수록 응답이 커진다
     */
    public List<TransactionsResponse> getCurrencyTransactions(UUID userId) {
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        User user = userQueryService.getTarget(userId);

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
     *
     * @param userId 요청자 — 호출 잔존 추적 로그에만 쓰인다
     * @param type   구앱이 보낸 적립 사유. 검증조차 하지 않는다
     * @param amount 구앱이 보낸 금액. 잔액에 더해지지 않는다
     */
    public void earnCurrency(UUID userId, CurrencyTransactionType type, int amount) {
        log.info("/currency/earn no-op — 클라 적립 폐쇄(세션 보상은 서버 지급). userId={}, type={}, amount={}",
                userId, type, amount);
    }

    /**
     * 클라 요청으로 잔액을 차감하고 원장에 사용 기입을 남긴다.
     *
     * <p>차감과 기입이 한 트랜잭션이라 둘 중 하나만 남는 상태는 없다. 잔액이 모자라면
     * {@code INSUFFICIENT_CURRENCY} 로 전부 롤백되므로 잔액이 음수로 내려가지 않는다.
     *
     * @param userId 차감 대상. 탈퇴했거나 없는 유저면 NOT_FOUND(404)
     * @param type   차감 사유. 클라 경로에서는 PURCHASE 만 허용하고, 서버 전용 타입은
     *               ILLEGAL_SPEND_REASON 으로 거절해 임의 발행·정산 위장을 막는다
     * @param amount 차감할 금액(양수). 원장에도 양수로 기입되고 방향은 type 이 표현한다
     */
    @Transactional
    public void spendCurrency(UUID userId, CurrencyTransactionType type, int amount) {
        User user = requireActiveUser(userId);

        if (type != CurrencyTransactionType.PURCHASE) {
            throw new CurrencyException(CurrencyErrorCode.ILLEGAL_SPEND_REASON);
        }

        UserWallet wallet = userQueryService.getWallet(userId);
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
        return userQueryService.getTargetForShare(userId);
    }
}
