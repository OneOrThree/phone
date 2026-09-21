package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.repository.IslandConstructionContributionRepository;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.IslandWalletTransactionRepository;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionContributionId;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.repository.domain.IslandWallet;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransaction;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransactionType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Collection;
import java.util.OptionalInt;
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
            accumulateShare(islandId, state.getTargetEpoch(), userId, amount);
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
     * 황금 물고기 적립(GROMO-1956) — 같이 집중 보너스의 세 기록을 <b>한 트랜잭션에</b> 확정한다:
     * 섬 잔액 +{@code reward}(한 번), 함께 낚은 주민의 건설 «각자 몫» +{@code sharePerMember}(각자),
     * 그리고 원장 한 줄. 주민별 누적 획득 기록은 집중 적립 원장 축이라 호출측이 쓴다
     * ({@code focus_reward_accruals.golden_fish}).
     *
     * <p>{@link #contribute} 를 재사용할 수 없는 이유가 여기 있다 — 그쪽은 지갑과 각자 몫에 <b>같은 값</b>을
     * 넣는다. 황금은 잔액에 50, 각자 몫에 50 ÷ 인원(내림)이고 나머지는 잔액에만 남는다(기획 정본
     * 「나누고 남은 물고기는 섬 잔액에만 남는다」). 각자 몫을 <b>쓰는 규칙</b>은 그래도 하나를 공유한다
     * ({@link #accumulateShare}) — 함께 낚은 주민 중 이번 목표의 대상이 아닌 사람(목표 선택 뒤 가입)이
     * 있으면 그 사람 몫은 오류가 아니라 섬 잔액에만 남는다. 분모는 그대로 「함께 낚은 인원」이다 —
     * 정본이 대상 인원이 아니라 함께 낚은 인원으로 나누라고 했다.
     *
     * <p><b>멱등의 자리는 이 메서드 하나다.</b> 지갑 행을 잠근 뒤 원장을 보고, 이미 있으면 <b>아무것도
     * 쓰지 않고</b> {@code false} 를 돌려준다 — 잔액·각자 몫·원장이 같은 트랜잭션이라 「잔액만 두 번」이
     * 생길 수 없다. 같은 키의 동시 요청은 지갑 행 잠금이 직렬화하고
     * {@code uq_island_wallet_tx_idem} 이 최후 방어선이다. 인메모리 플래그는 두지 않는다.
     *
     * <p>잠금 순서는 {@link #contribute} 와 같다(건설 상태 → 지갑) — 각자 몫을 쓰려면 목표 epoch 이
     * 필요하고, 거꾸로 잡으면 건설 명령과 교착 쌍이 된다. 호출측은 이보다 «위»에서 세션 상세를 이미
     * 잠근 채 들어온다(집중 적립 틱과 같은 꼬리 순서: 상세 → 건설 상태 → 통장).
     *
     * @param islandId       황금 물고기가 나타난 섬
     * @param reward         섬 잔액에 더할 총량(기획 정본의 50)
     * @param sharePerMember 주민 한 명의 건설 각자 몫(50 ÷ 인원, 내림). 0 이면 각자 몫을 쓰지 않는다
     * @param memberIds      함께 낚은 주민 — 호출측이 <b>정렬해</b> 넘긴다(동시 기여와 교착하지 않도록)
     * @param idempotencyKey 추첨 하나의 키 — {@code golden:<추첨 분 epoch 초>}
     * @return 이번에 적립했으면 {@code true}, 같은 추첨이 이미 적립돼 있으면 {@code false}
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean creditGoldenFish(UUID islandId, int reward, int sharePerMember,
                                    Collection<UUID> memberIds, String idempotencyKey) {
        if (reward <= 0 || sharePerMember < 0) {
            throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        }
        states.insertIfAbsent(islandId);
        IslandConstructionState state = states.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 건설 상태를 만들 직후에 찾지 못했습니다."));
        wallets.insertIfAbsent(islandId);
        IslandWallet wallet = wallets.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 지갑을 만들 직후에 찾지 못했습니다."));
        // 잠금 «아래» 에서만 판정한다 — 잠금 전 판정은 같은 키의 동시 요청을 둘 다 통과시킨다.
        if (ledger.existsByIslandIdAndTypeAndIdempotencyKey(
                islandId, IslandWalletTransactionType.GOLDEN_FISH, idempotencyKey)) {
            return false;
        }
        if (reward > Integer.MAX_VALUE - wallet.getBalance()) {
            throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        }
        wallet.earn(reward);
        // 「각자 몫은 목표를 고른 뒤부터 모은 물고기로 판단한다」(정책 P-D04) — 목표가 없으면 잔액만 는다.
        if (sharePerMember > 0 && state.getTargetBuildingId() != null) {
            for (UUID memberId : memberIds) {
                accumulateShare(islandId, state.getTargetEpoch(), memberId, sharePerMember);
            }
        }
        ledger.save(IslandWalletTransaction.builder()
                .islandId(islandId).amount(reward)
                .type(IslandWalletTransactionType.GOLDEN_FISH)
                .idempotencyKey(idempotencyKey)
                .build());
        return true;
    }

    /**
     * 건설 「각자 몫」 한 사람 몫의 누적 — 집중 적립({@link #contribute})과 황금 물고기
     * ({@link #creditGoldenFish})이 <b>같은 규칙</b>을 쓰는 단일 자리다(GROMO-1999).
     *
     * <p>누적은 «이미 있는 대상 행만» UPDATE 한다. 대상 명단은 목표를 고를 때 고정되므로
     * (기획 정본 「목표 선택 시점의 주민으로 대상을 고정한다」), 그 뒤에 가입한 주민은 행이 없다.
     * 그 사람의 물고기가 사라지는 것은 아니다 — <b>섬 잔액과 원장에는 그대로 들어가고</b> 다만
     * 이번 건설 퀘스트의 몫으로 세지 않을 뿐이다. 황금 물고기도 같은 결이라 정본의
     * 「나누고 남은 물고기는 섬 잔액에만 남는다」와 어긋나지 않는다.
     *
     * <p>그래서 0 행의 <b>두 원인을 가른다</b>:
     * <ul>
     *   <li>행이 <b>없다</b> → 대상 밖. 정상 흐름이라 조용히 지나간다.</li>
     *   <li>행이 <b>있다</b> → upsert 의 WHERE 가 막은 {@code integer} 상한 초과. 진짜 오류다.</li>
     * </ul>
     * 같은 섬의 기여는 모두 호출측이 잡은 건설 상태 행 잠금 아래 직렬되므로 이 판정에 경합이 없다.
     */
    private void accumulateShare(UUID islandId, long epoch, UUID userId, int amount) {
        if (contributions.accumulate(islandId, epoch, userId, amount, clock.instant()) == 0
                && contributions.existsById(
                        new IslandConstructionContributionId(islandId, epoch, userId))) {
            throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        }
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

    /**
     * 상점 구매 차감(GROMO-1781) — {@link #debitForConstruction} 과 같은 규율로 잠긴 지갑에서 가격을 빼고 원장에
     * 적는다. 잔액이 모자라면 아무것도 바꾸지 않고 {@code false} 다 — 「모자라다」를 어떤 공개 실패로 낼지는
     * 상점 도메인이 정한다(건설과 달리 상점 오류 코드로 나가야 해서 여기서 예외를 고르지 않는다).
     *
     * <p>잠금은 지갑 행 하나다 — 호출측(구매)이 사용자·섬·멤버십·카탈로그 포인터를 먼저 잡고 들어온다
     * (상점 LLD §4 공통 잠금 계열의 wallet 자리). {@code uq_island_wallet_tx_idem} 이 같은 키의 이중 기입을
     * 막는 최후 방어선이다.
     *
     * @return 차감 후 잔액, 모자라면 빈 값
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public OptionalInt debitForShop(UUID islandId, int amount, String idempotencyKey) {
        wallets.insertIfAbsent(islandId);
        IslandWallet wallet = wallets.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 지갑을 만들 직후에 찾지 못했습니다."));
        if (!wallet.trySpend(amount)) {
            return OptionalInt.empty();
        }
        ledger.save(IslandWalletTransaction.builder()
                .islandId(islandId).amount(amount)
                .type(IslandWalletTransactionType.SHOP_PURCHASE)
                .idempotencyKey(idempotencyKey)
                .build());
        return OptionalInt.of(wallet.getBalance());
    }
}
