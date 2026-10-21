package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.CustomizationRewardResult;
import com.oneorthree.phone.appearance.repository.CustomizationRewardItemRepository;
import com.oneorthree.phone.appearance.repository.CustomizationRewardPolicyRepository;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardItem;
import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSessionKind;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 꾸미기 보상 지급 (GROMO-2301) — 추첨 계산 실패는 보상만 건너뛰고, 보유 행은 «꽂혔을 때만» 새로 가진 것으로 친다.
 * 후보를 한 줄로 두어 15분 이상이면 언제나 그 아이템이 뽑힌다.
 */
@ExtendWith(MockitoExtension.class)
class CustomizationRewardServiceTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID SESSION = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-21T03:00:00Z");
    private static final CustomizationRewardItem HAT = CustomizationRewardItem.builder()
            .revision(2).productId("cust.head.test").category("head").rarity("common").sortOrder(0).build();

    @Mock
    private CustomizationRewardPolicyRepository policies;
    @Mock
    private CustomizationRewardItemRepository items;
    @Mock
    private OwnedProductRepository ownedProducts;
    @Mock
    private AppearanceEvents appearanceEvents;
    @InjectMocks
    private CustomizationRewardService service;

    @Test
    @DisplayName("보유 행이 새로 꽂히면 처음 가짐(NEW!)이고 인벤토리 사건을 하나 적는다 — 출처는 focus:<세션>")
    void grantsAndRecordsTheEventWhenTheRowIsInserted() {
        givenPolicy(Map.of("ISLAND", weights(), "SEA", weights()));
        EventEnvelope event = mock(EventEnvelope.class);
        given(ownedProducts.insertUserProductIfAbsent(any(UUID.class), eq(USER), eq(HAT.getProductId()),
                eq("focus:" + SESSION), eq(NOW))).willReturn(1);
        given(appearanceEvents.inventoryChanged(CatalogAsset.OWNER_USER, USER, USER, HAT.getProductId()))
                .willReturn(event);

        Optional<CustomizationRewardResult> result = service.settle(USER, SESSION, FocusSessionKind.ISLAND, 900, NOW);

        assertThat(result).contains(new CustomizationRewardResult(2, HAT.getProductId(), true, List.of(event)));
    }

    @Test
    @DisplayName("이미 가진 상품이라 0행이면(먼저 있었든 경합에서 졌든) 결과는 그 상품이지만 처음 가짐이 아니고 사건도 없다")
    void keepsTheResultWithoutAnEventWhenTheRowAlreadyExists() {
        givenPolicy(Map.of("ISLAND", weights(), "SEA", weights()));
        given(ownedProducts.insertUserProductIfAbsent(any(UUID.class), eq(USER), eq(HAT.getProductId()),
                anyString(), eq(NOW))).willReturn(0);

        Optional<CustomizationRewardResult> result = service.settle(USER, SESSION, FocusSessionKind.SEA, 900, NOW);

        assertThat(result).contains(new CustomizationRewardResult(2, HAT.getProductId(), false, List.of()));
        verify(appearanceEvents, never()).inventoryChanged(any(), any(), any(), any());
    }

    @Test
    @DisplayName("정책 JSON 에 장소 키가 없어 추첨 계산이 실패하면 예외 없이 빈 결과 — 보유 행을 건드리지 않는다")
    void brokenPolicySkipsOnlyTheReward() {
        givenPolicy(Map.of("ISLAND", weights()));

        assertThat(service.settle(USER, SESSION, FocusSessionKind.SEA, 3600, NOW)).isEmpty();

        verify(ownedProducts, never()).insertUserProductIfAbsent(any(), any(), any(), any(), any());
    }

    private void givenPolicy(Map<String, Object> locationWeights) {
        given(policies.findTopByOrderByRevisionDesc()).willReturn(Optional.of(CustomizationRewardPolicy.builder()
                .revision(2).minimumActiveSeconds(900).rareUnlockSeconds(1800).legendaryUnlockSeconds(3600)
                .timeHalfSeconds(7200).rareMaxBonusPpm(30_000).legendaryMaxBonusPpm(10_000)
                .locationWeights(locationWeights).categoryWeights(Map.of("head", 1)).build()));
        given(items.findByRevision(2)).willReturn(List.of(HAT));
    }

    private static Map<String, Integer> weights() {
        return Map.of("common", 48, "uncommon", 30, "rare", 18, "legendary", 4);
    }
}
