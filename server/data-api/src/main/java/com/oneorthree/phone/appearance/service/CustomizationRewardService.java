package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.CustomizationRewardResult;
import com.oneorthree.phone.appearance.repository.CustomizationRewardItemRepository;
import com.oneorthree.phone.appearance.repository.CustomizationRewardPolicyRepository;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardItem;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardPolicy;
import com.oneorthree.phone.appearance.support.CustomizationRewardDraw;
import com.oneorthree.phone.common.id.UuidV7;
import com.oneorthree.phone.focus.repository.domain.FocusSessionKind;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 집중 꾸미기 보상 지급 (GROMO-2301) — 섬·바다 집중 한 번이 끝날 때 휴식 제외 집중이 정책의 최소 시간(15분) 이상이면
 * 꾸미기 아이템을 정확히 1개 뽑는다. 세션끼리 시간을 더하지 않고 누적 단계표도 없다.
 *
 * <p>추첨은 {@link CustomizationRewardDraw} 의 순수 함수이고 세션 id 로 고정돼 있다. 이 서비스는 지금 정책(가장 큰
 * revision)과 그 후보를 읽어 넘기고, 뽑힌 상품을 <b>처음 가질 때만</b> 개인 인벤토리({@code owned_products})에 넣는다 —
 * 이미 가진 상품이 뽑혀도 결과는 그 상품이다(중복 획득). 넣기는 {@code ON CONFLICT DO NOTHING}(V64 부분 유일 인덱스)이라
 * 같은 상품을 먼저 넣은 트랜잭션이 있어도 유일 위반으로 정산이 실패하지 않고, 꽂혔을 때만 인벤토리 사건을 적는다.
 *
 * <p>정책 JSON 이 어긋나 추첨 계산이 실패하면 error 로그만 남기고 보상을 건너뛴다 — 집중 종료는 계속한다.
 *
 * <p>잠금 순서: 호출자가 쥔 사용자(공유)·섬·멤버십·상세·기본 마커 뒤에 보유 행 삽입 → 인벤토리 사건
 * ({@code aggregate_versions}) 이다. 결과는 호출자가 정산 행에 남겨 재조회가 다시 뽑지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CustomizationRewardService {

    private final CustomizationRewardPolicyRepository policies;
    private final CustomizationRewardItemRepository items;
    private final OwnedProductRepository ownedProducts;
    private final AppearanceEvents appearanceEvents;

    /**
     * 집중 한 번의 꾸미기 보상 — 호출자의 트랜잭션에 합류해야 한다({@code MANDATORY}). 별도 트랜잭션이면 집중 종료가
     * 롤백돼도 상품이 남는다.
     *
     * @param sessionId     추첨 씨앗이자 지급 근거({@code granted_ref = focus:<세션>})
     * @param location      섬(ISLAND)·바다(SEA) — 장소별 기본 가중치를 고른다
     * @param activeSeconds 이번 세션의 휴식 제외 집중 초
     * @param now           지급 시각
     * @return 뽑힌 상품. 최소 시간 미만이거나 정책·후보가 없으면 빈 값이다 — 정책이 없어도 정산은 계속한다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<CustomizationRewardResult> settle(UUID userId, UUID sessionId, FocusSessionKind location,
                                                      long activeSeconds, Instant now) {
        CustomizationRewardPolicy policy = policies.findTopByOrderByRevisionDesc().orElse(null);
        if (policy == null) {
            log.error("꾸미기 보상 정책이 없어 보상만 건너뜁니다 — 정산은 계속한다. session={}, user={}", sessionId, userId);
            return Optional.empty();
        }
        if (activeSeconds < policy.getMinimumActiveSeconds()) {
            return Optional.empty();
        }
        List<CustomizationRewardItem> candidates = items.findByRevision(policy.getRevision());
        CustomizationRewardItem won;
        try {
            // 정책 JSON(장소·등급 키)이 어긋나도 집중 종료 전체를 되돌리지 않는다 — 순수 계산만 감싸고, DB 읽기·쓰기는
            // 밖에 둔다(그쪽 예외는 트랜잭션을 이미 망가뜨려 삼켜 봐야 커밋되지 않는다).
            won = CustomizationRewardDraw.pick(policy, candidates, location, activeSeconds, sessionId).orElse(null);
        } catch (RuntimeException e) {
            log.error("꾸미기 보상 추첨 계산이 실패해 보상만 건너뜁니다 — 정책 확인 필요. revision={}, location={}, session={}",
                    policy.getRevision(), location, sessionId, e);
            return Optional.empty();
        }
        if (won == null) {
            log.error("꾸미기 보상 후보가 없어 보상만 건너뜁니다 — revision={}, session={}", policy.getRevision(),
                    sessionId);
            return Optional.empty();
        }
        // 없을 때만 꽂는다 — 0행이면 이미 가진 상품(중복 획득)이라 결과만 남기고 사건을 적지 않는다.
        boolean inserted = ownedProducts.insertUserProductIfAbsent(UuidV7.next(), userId, won.getProductId(),
                "focus:" + sessionId, now) == 1;
        List<EventEnvelope> events = inserted
                ? List.of(appearanceEvents.inventoryChanged(CatalogAsset.OWNER_USER, userId, userId,
                        won.getProductId()))
                : List.of();
        return Optional.of(new CustomizationRewardResult(policy.getRevision(), won.getProductId(), inserted, events));
    }
}
