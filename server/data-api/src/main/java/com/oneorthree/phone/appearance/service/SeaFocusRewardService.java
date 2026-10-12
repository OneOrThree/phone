package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.SeaRewardResult;
import com.oneorthree.phone.appearance.repository.CatalogAssetRepository;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.SeaFocusTotalRepository;
import com.oneorthree.phone.appearance.repository.SeaRewardTierRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.repository.domain.OwnedProduct;
import com.oneorthree.phone.appearance.repository.domain.SeaFocusTotal;
import com.oneorthree.phone.appearance.repository.domain.SeaRewardTier;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 바다 집중 누적과 단계표 보상 엔진 (GROMO-2274, 섬 외부 계약 §8) — 바다 집중 한 번이 끝날 때 평생·이번 달 누적을
 * 늘리고, 그 가산으로 <b>새로 넘은</b> 단계의 상품을 개인 인벤토리({@code owned_products})에 넣는다.
 *
 * <h2>무엇을 정하고 무엇을 안 정하는가</h2>
 * 이 서비스는 「바다 세션이 무엇인가」를 모른다. 호출자(집중 종료의 {@code FocusSessionLifecycleService.settle})가
 * 바다 세션이라고 판정해 순수 집중 초를 넘겨 줄 때만 돈다 — 그 판정 자리가
 * {@code internal/service/SeaSessionPredicate} seam 이다. 섬 세션의 통장 적립·황금 물고기와는 한 줄도 섞이지 않는다.
 *
 * <h2>단계표는 데이터다</h2>
 * 단계표({@code sea_reward_tiers})는 운영이 SQL 로 넣는다. 세트는 둘이다 — {@code base}(평생 누적 기준, 상시)와
 * {@code YYYY-MM}(그 달 누적 기준, 시즌). 다음 달 시즌은 그 달 키로 행을 넣으면 열린다. 코드 배포가 없다.
 * 단계는 {@code 이전 누적 < 기준 ≤ 이후 누적} 일 때 «넘은» 것이다 — 이미 지나간 단계는 행이 나중에 생겨도
 * 소급해 주지 않고, 한 번 넘은 단계가 다시 넘어지는 일도 없다(누적은 줄지 않고, 월 누적은 달이 갈릴 때만 0 이 된다).
 * 달 경계를 걸친 세션은 정산 시각의 달에 «전부» 센다 — 구간별로 쪼개지 않는다.
 *
 * <h2>1회 보장</h2>
 * 이미 가진 상품은 건너뛴다 — {@code (user_id, product_id)} 부분 유일 인덱스(V64)가 최후 방어선이고, 이 서비스는
 * 그 앞에서 확인한다. 상점 구매와는 사용자 행 잠금(정산은 공유, 구매는 배타)이 줄을 세워 서로를 앞지르지 못한다.
 *
 * <h2>지급하지 않는 종류</h2>
 * 개인 인벤토리는 {@code clothes}·{@code decor} 만 받는다. 그 밖의 종류가 단계표에 와도 건너뛰고 경고를 남긴다
 * (결정 N4 — hull 은 B23/GROMO-1851 번복이 필요해 후속이다). 건너뛴 행은 «다음 단계» 안내에도 넣지 않는다 —
 * 받지 못할 상품을 향해 남은 분을 보여 주지 않는다.
 *
 * <h2>잠금 순서</h2>
 * 호출자가 쥔 사용자(공유)·섬·멤버십·상세 뒤에 이 유저의 누적 행(배타) → 보유 행 삽입 → 인벤토리 사건
 * ({@code aggregate_versions}) 이다. 누적 행은 유저 단위라 다른 유저의 정산과 겹치지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SeaFocusRewardService {

    private final SeaFocusTotalRepository totals;
    private final SeaRewardTierRepository tiers;
    private final CatalogAssetRepository catalogAssets;
    private final OwnedProductRepository ownedProducts;
    private final AppearanceEvents appearanceEvents;

    /**
     * 바다 집중 한 번의 정산 — 누적 가산 → 넘은 단계 지급 → 다음 단계까지 남은 분.
     *
     * <p>호출자의 트랜잭션에 합류해야 한다({@code MANDATORY}) — 별도 트랜잭션이면 집중 종료가 롤백돼도 상품이
     * 남는다. 「도착 여부 무관」이라 섬·항해 상태를 보지 않는다.
     *
     * @param userId        정산 대상
     * @param activeSeconds 이번 세션의 순수 집중 초(휴식 제외). 0 이어도 된다
     * @param now           정산 시각 — KST 로 본 달이 {@code month_key} 가 되고, 지급 시각이 된다
     * @return 이번에 새로 받은 상품과 다음 단계까지 남은 분
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public SeaRewardResult settle(UUID userId, long activeSeconds, Instant now) {
        if (activeSeconds < 0) {
            throw new IllegalArgumentException("순수 집중 초는 음수일 수 없습니다: " + activeSeconds);
        }
        String monthKey = YearMonth.from(now.atZone(ZonePolicy.KST)).toString();
        // 행이 없으면 0 누적으로 만들고 잠근다 — 첫 정산 둘이 겹쳐도 PK 위반으로 종료가 실패하지 않는다.
        totals.insertIfAbsent(userId, monthKey, now);
        SeaFocusTotal total = totals.findForUpdate(userId)
                .orElseThrow(() -> new IllegalStateException("바다 누적 행을 잠글 수 없습니다 — user=" + userId));
        long lifetimeBefore = total.getLifetimeSeconds();
        long monthBefore = total.monthSecondsIn(monthKey);
        total.add(activeSeconds, monthKey, now);
        long lifetimeAfter = total.getLifetimeSeconds();
        long monthAfter = total.getMonthSeconds();

        // ponytail: 두 세트의 단계를 전부 읽어 메모리에서 거른다 — 세트당 수십 행인 운영 카탈로그라 충분하다.
        // 수천 행이 되면 «넘은 단계»와 «다음 단계»를 SQL 두 문장으로 나눈다.
        List<SeaRewardTier> rows = tiers.findBySetKeys(List.of(SeaRewardTier.BASE_SET, monthKey));
        Map<String, String> kinds = kindsOf(rows);
        List<String> granted = new ArrayList<>();
        List<EventEnvelope> events = new ArrayList<>();
        long remainingSeconds = Long.MAX_VALUE;
        for (SeaRewardTier tier : rows) {
            long before = tier.isBase() ? lifetimeBefore : monthBefore;
            long after = tier.isBase() ? lifetimeAfter : monthAfter;
            long threshold = tier.thresholdSeconds();
            boolean crossed = before < threshold && threshold <= after;
            if (!isGrantable(kinds.get(tier.getProductId()))) {
                if (crossed) {
                    log.warn("바다 보상 단계의 상품은 개인 인벤토리에 지급하지 않습니다(clothes·decor 만, 결정 N4) — "
                                    + "set={}, threshold={}분, product={}, kind={}, user={}",
                            tier.getSetKey(), tier.getThresholdMinutes(), tier.getProductId(),
                            kinds.get(tier.getProductId()), userId);
                }
                continue;
            }
            if (crossed) {
                if (ownedProducts.existsByUserIdAndProductId(userId, tier.getProductId())) {
                    log.debug("바다 보상 단계의 상품을 이미 가지고 있어 건너뜁니다 — set={}, threshold={}분, product={}",
                            tier.getSetKey(), tier.getThresholdMinutes(), tier.getProductId());
                    continue;
                }
                ownedProducts.save(OwnedProduct.granted(CatalogAsset.OWNER_USER, userId, tier.getProductId(),
                        "sea:" + tier.getSetKey() + ":" + tier.getThresholdMinutes(), now));
                events.add(appearanceEvents.inventoryChanged(CatalogAsset.OWNER_USER, userId, userId,
                        tier.getProductId()));
                granted.add(tier.getProductId());
            } else if (threshold > after) {
                remainingSeconds = Math.min(remainingSeconds, threshold - after);
            }
        }
        // 남은 초를 올림해 분으로 — 1초가 남아도 「0분 남음」으로 보이지 않는다.
        Integer minutesToNextTier = remainingSeconds == Long.MAX_VALUE ? null
                : Math.toIntExact((remainingSeconds + 59) / 60);
        return new SeaRewardResult(List.copyOf(granted), minutesToNextTier, List.copyOf(events));
    }

    /**
     * 계정 탈퇴 파기 (GROMO-2274 × 계정 LLD §4, 계약 §0 N42) — 개인 누적 이력을 지운다. 사용자 행은 익명화만 되고
     * 삭제되지 않아 V112 의 {@code ON DELETE CASCADE} 가 돌지 않는다. 지급된 상품({@code owned_products})은 따로
     * 지울 것이 없다 — {@link AppearanceService#eraseWithdrawnUser} 가 개인 보유 행을 이미 지운다. 단계표는 운영
     * 카탈로그라 유저와 무관하다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void eraseWithdrawnUser(UUID userId) {
        totals.deleteAllOfUser(userId);
    }

    /** 단계표가 가리키는 상품들의 종류 — 상품 id → kind. FK 가 있어 빠지는 상품은 없다. */
    private Map<String, String> kindsOf(List<SeaRewardTier> rows) {
        List<String> productIds = rows.stream().map(SeaRewardTier::getProductId).distinct().toList();
        if (productIds.isEmpty()) {
            return new HashMap<>();
        }
        return catalogAssets.findAllById(productIds).stream()
                .collect(Collectors.toMap(CatalogAsset::getProductId, CatalogAsset::getKind));
    }

    private static boolean isGrantable(String kind) {
        return CatalogAsset.KIND_CLOTHES.equals(kind) || CatalogAsset.KIND_DECOR.equals(kind);
    }
}
