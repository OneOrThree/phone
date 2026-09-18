package com.oneorthree.phone.internal;

import com.oneorthree.phone.construction.service.IslandConstructionService;
import com.oneorthree.phone.construction.dto.ConstructionOptionsView;
import com.oneorthree.phone.internal.dto.ConstructionStartRequest;
import com.oneorthree.phone.construction.dto.ConstructionStartedView;
import com.oneorthree.phone.internal.dto.ConstructionTargetRequest;
import com.oneorthree.phone.construction.dto.ConstructionTargetView;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 섬 건설의 <b>섬 축</b> 내부 표면 (GROMO-1767) — 공개 {@code GET /islands/{islandId}/
 * construction-options} · {@code PUT /islands/{islandId}/construction-target} ·
 * {@code POST /islands/{islandId}/constructions} 의 상류다.
 *
 * <p>자원이 섬이라 {@code InternalIslandController} 와 같은 {@code /internal/islands/{islandId}}
 * 축을 쓰고, 주체는 {@code InternalAuthFilter} 가 서비스 토큰과 함께 검증한 {@code X-User-Id}
 * 헤더로만 받는다 — 요청에 사용자 ID·가격·잔액을 받지 않는다(LLD §2).
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandConstructionController {

    private final IslandConstructionService construction;

    /** 건설 옵션 조회 — 활성 주민 전용. 변경 권한이 없는 주민은 항목별 FORBIDDEN 사유를 본다(C08). */
    @GetMapping("/internal/islands/{islandId}/construction-options")
    public ConstructionOptionsView options(@PathVariable UUID islandId,
                                           @RequestHeader("X-User-Id") UUID userId) {
        return construction.options(islandId, userId);
    }

    /** 목표 변경 — 차감 0. 같은 목표·현재 version 은 무변경 200 이다(정책 C03·C11). */
    @PutMapping("/internal/islands/{islandId}/construction-target")
    public ConstructionTargetView setTarget(@PathVariable UUID islandId,
                                            @RequestHeader("X-User-Id") UUID userId,
                                            @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                            @Valid @RequestBody ConstructionTargetRequest body) {
        return construction.setTarget(islandId, userId, body.buildingId(), body.expectedVersion(),
                idempotencyKey);
    }

    /** 건설 시작 — 재검증한 가격으로 BUILDING 을 접수한다. 즉시 완공 응답은 폐기됐다. */
    @PostMapping("/internal/islands/{islandId}/constructions")
    public ConstructionStartedView start(@PathVariable UUID islandId,
                                         @RequestHeader("X-User-Id") UUID userId,
                                         @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                         @Valid @RequestBody ConstructionStartRequest body) {
        return construction.start(islandId, userId, body.buildingId(), body.expectedVersion(),
                body.expectedCostPolicyVersion(), idempotencyKey);
    }
}
