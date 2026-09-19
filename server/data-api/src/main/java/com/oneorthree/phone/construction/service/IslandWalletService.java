package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.repository.IslandConstructionContributionRepository;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.IslandWalletTransactionRepository;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.repository.domain.IslandWallet;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransaction;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransactionType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

/**
 * 섬 공동 지갑(village_points)의 잔액·원장 — 개인 {@code CurrencyLedgerService} 의 섬 축 대응물.
 *
 * <p>잠금 규율은 개인 원장과 같다: 잔액을 <b>바꾸는</b> 경로만 지갑 행을 배타 락으로 잡고,
 * 표시용 {@link #balanceOf} 는 락 없이 읽는다. 잠금 순서(LLD §4)상 지갑은 섬·시설·정책
 * 잠금 <b>뒤</b>에 잡으므로 여기 메서드는 {@code MANDATORY} 다 — 트랜잭션 밖 호출은 잠금이
 * 즉시 풀려 아무 일도 하지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandWalletService {

    private final IslandWalletRepository wallets;
    private final IslandWalletTransactionRepository ledger;
    private final IslandConstructionStateRepository states;
    private final IslandConstructionContributionRepository contributions;
    private final Clock clock;

    /** 표시용 잔액 — 지갑 행이 아직 없는 섬은 0원으로 읽는다. */
    public int balanceOf(UUID islandId) {
        return wallets.findById(islandId).map(IslandWallet::getBalance).orElse(0);
    }

    /**
     * 주민 기여 적립 — 「각자 몫 n빵」의 두 기록을 한 번에 쓴다: 섬 지갑 잔액과, 현재 목표
     * epoch 아래의 주민별 누적 기여. 「물고기 잔액과 주민별 누적 획득 기록은 구분한다」는
     * 기획 정본의 두 축이 이 메서드의 두 쓰기다.
     *
     * <p>단, 주민별 기여는 목표가 골라져 있을 때만 쓴다 — 「각자 몫은 목표를 고른 뒤부터
     * 모은 물고기로 판단한다」(정책 P-D04)라 무목표 적립은 지갑·원장만 남긴다.
     *
     * <p>호출부는 집중 finish 정산이다(GROMO-1924 — 섬 통장 몫 C, 키 {@code focus:<sessionId>}).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void contribute(UUID islandId, UUID userId, int amount, String idempotencyKey) {
        if (amount <= 0) {
            throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        }
        if (ledger.existsByIslandIdAndTypeAndIdempotencyKey(
                islandId, IslandWalletTransactionType.CONTRIBUTION, idempotencyKey)) {
            return;
        }
        // 잠금 순서(LLD §4)는 건설 명령과 같다 — 건설 상태 → 지갑. 거꾸로 잡으면 POST 와
        // 기여가 서로를 기다리는 데드락 쌍이 된다.
        states.insertIfAbsent(islandId);
        IslandConstructionState state = states.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 건설 상태를 만들 직후에 찾지 못했습니다."));
        // 잠금 아래 재검사 — 잠금 전 판정만으론 같은 키의 동시 요청이 둘 다 통과해 후발이
        // 유니크 제약(최후 방어선)에서 깨진다. 상태 행 잠금이 같은 섬의 기여를 직렬화하므로
        // 후발은 선발의 커밋된 기입을 여기서 본다.
        if (ledger.existsByIslandIdAndTypeAndIdempotencyKey(
                islandId, IslandWalletTransactionType.CONTRIBUTION, idempotencyKey)) {
            return;
        }
        wallets.insertIfAbsent(islandId);
        IslandWallet wallet = wallets.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 지갑을 만들 직후에 찾지 못했습니다."));
        // 잔액은 int 열 — 조용한 wrap 대신 도메인 거절로 돌린다.
        if (amount > Integer.MAX_VALUE - wallet.getBalance()) {
            throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        }
        wallet.earn(amount);
        // 「각자 몫은 목표를 고른 뒤부터 모은 물고기로 판단한다」(정책 P-D04) — 목표가 없는
        // 동안의 적립은 지갑·원장만 남기고 주민별 기여는 세지 않는다. 세웠다면 이후 어떤
        // 목표에도 속하지 않는 유령 몫이 된다.
        if (state.getTargetBuildingId() != null) {
            // 기여 누적도 int 열 — upsert 의 WHERE 가 상한 초과 갱신을 건너뛰면 0 행이다.
            // 같은 섬의 기여는 모두 이 상태 행 잠금 아래 직렬되므로 0 은 곧 상한 거절이다.
            if (contributions.accumulate(islandId, state.getTargetEpoch(), userId, amount,
                    clock.instant()) == 0) {
                throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
            }
        }
        ledger.save(IslandWalletTransaction.builder()
                .islandId(islandId).amount(amount)
                .type(IslandWalletTransactionType.CONTRIBUTION)
                .idempotencyKey(idempotencyKey)
                .build());
    }

    /**
     * 퀘스트 정산 적립(GROMO-1773) — 잔액과 원장만 쓰고 건설 「각자 몫」 기여는 <b>쌓지 않는다</b>.
     * 퀘스트 보상은 주민 누구의 획득도 아니라 섬 전체의 몫이라, {@link #contribute} 처럼 목표 epoch
     * 기여로 세면 건설 문턱을 보상으로 우회하게 된다.
     *
     * <p>잠금은 지갑 행 하나다 — 호출측(퀘스트 claim)이 섬·회차를 먼저 잡고 들어온다(LLD §5 순서의 끝).
     * 같은 키 재실행은 지갑 잠금 아래에서 원장을 보고 조용히 건너뛴다. 유니크 제약
     * {@code uq_island_wallet_tx_idem} 이 최후 방어선이다.
     *
     * @return 적립 후 잔액
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public int creditQuestSettlement(UUID islandId, int amount, String idempotencyKey) {
        if (amount <= 0) {
            throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        }
        wallets.insertIfAbsent(islandId);
        IslandWallet wallet = wallets.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 지갑을 만들 직후에 찾지 못했습니다."));
        if (ledger.existsByIslandIdAndTypeAndIdempotencyKey(
                islandId, IslandWalletTransactionType.QUEST_SETTLEMENT, idempotencyKey)) {
            return wallet.getBalance();
        }
        if (amount > Integer.MAX_VALUE - wallet.getBalance()) {
            throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        }
        wallet.earn(amount);
        ledger.save(IslandWalletTransaction.builder()
                .islandId(islandId).amount(amount)
                .type(IslandWalletTransactionType.QUEST_SETTLEMENT)
                .idempotencyKey(idempotencyKey)
                .build());
        return wallet.getBalance();
    }

    /**
     * 건설 확정 차감 — 잠긴 지갑에서 총액을 빼고 원장에 기입한다. 잔액 부족이면
     * {@code INSUFFICIENT_FUNDS}(409) — 「모자라다」를 어떤 실패로 보고할지는 이 도메인이 정한다.
     *
     * @return 차감 후 잔액 — 응답의 {@code villagePoints} 다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public int debitForConstruction(UUID islandId, int amount, String idempotencyKey) {
        wallets.insertIfAbsent(islandId);
        IslandWallet wallet = wallets.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 지갑을 만들 직후에 찾지 못했습니다."));
        if (!wallet.trySpend(amount)) {
            throw new ConstructionException(ConstructionErrorCode.INSUFFICIENT_FUNDS);
        }
        ledger.save(IslandWalletTransaction.builder()
                .islandId(islandId).amount(amount)
                .type(IslandWalletTransactionType.CONSTRUCTION_DEBIT)
                .idempotencyKey(idempotencyKey)
                .build());
        return wallet.getBalance();
    }
}
