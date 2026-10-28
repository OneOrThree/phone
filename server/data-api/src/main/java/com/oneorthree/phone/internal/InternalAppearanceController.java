package com.oneorthree.phone.internal;

import com.oneorthree.phone.appearance.dto.AppearanceCommandView;
import com.oneorthree.phone.appearance.dto.IslandAppearanceView;
import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;
import com.oneorthree.phone.appearance.dto.PersonalInventoryView;
import com.oneorthree.phone.appearance.dto.SharedInventoryView;
import com.oneorthree.phone.appearance.service.AppearanceService;
import com.oneorthree.phone.internal.dto.AppearancePatchRequest;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * 보유품·외양의 내부 표면 (GROMO-1783) — 공개 {@code GET /me/inventory} ·
 * {@code PATCH /me/appearance} · {@code GET /islands/{islandId}/inventory} ·
 * {@code PATCH /islands/{islandId}/appearance} 의 상류다.
 *
 * <p>개인 축은 {@code /internal/users/{userId}/…} — {@code InternalAuthFilter} 가 그 접두어에서
 * 경로의 userId 와 {@code X-User-Id} 의 일치를 강제하므로 위임 주체를 요청 본문으로 받지 않는다.
 * 섬 축은 {@code /internal/islands/{islandId}/…} 이며 주체는 {@code X-User-Id} 헤더다.
 *
 * <p>PATCH 본문은 tri-state 캐리어다 — 허용 필드·형식 검사는 Business 와 Data 양쪽에서 한다.
 */
@RestController
@RequiredArgsConstructor
public class InternalAppearanceController {

    private final AppearanceService appearance;

    /** 개인 인벤토리 — 본인 소유 상품 목록과 현재 외양을 한 스냅샷으로 돌려준다. */
    @GetMapping("/internal/users/{userId}/inventory")
    public PersonalInventoryView myInventory(@PathVariable UUID userId) {
        return appearance.myInventory(userId);
    }

    /** 개인 외양 적용 — 미제출 필드 유지·null 해제·값 적용. 같은 키의 재생은 receipt 를 돌려준다. */
    @PatchMapping("/internal/users/{userId}/appearance")
    public AppearanceCommandView<PersonalAppearanceView> patchMine(
            @PathVariable UUID userId,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey,
            @RequestBody AppearancePatchRequest body) {
        return appearance.patchMine(userId, idempotencyKey, body.fields(), body.values());
    }

    /** 공동 인벤토리 — 활성 주민 전용. 공동 소유 상품 목록과 현재 공동 외양을 돌려준다. */
    @GetMapping("/internal/islands/{islandId}/inventory")
    public SharedInventoryView islandInventory(@PathVariable UUID islandId,
                                               @RequestHeader("X-User-Id") UUID userId) {
        return appearance.islandInventory(islandId, userId);
    }

    /** 공동 외양 적용 — SHARED_APPEARANCE(방장) 전용·expectedVersion 낙관 검사. */
    @PatchMapping("/internal/islands/{islandId}/appearance")
    public AppearanceCommandView<IslandAppearanceView> patchIsland(
            @PathVariable UUID islandId,
            @RequestHeader("X-User-Id") UUID userId,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey,
            @RequestBody AppearancePatchRequest body) {
        return appearance.patchIsland(islandId, userId, idempotencyKey,
                body.fields(), body.values(), body.expectedVersion());
    }
}
