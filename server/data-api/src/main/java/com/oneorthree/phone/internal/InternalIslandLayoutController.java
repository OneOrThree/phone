package com.oneorthree.phone.internal;

import com.oneorthree.phone.construction.dto.IslandLayoutView;
import com.oneorthree.phone.construction.service.IslandConstructionService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 섬 배치 정본의 <b>섬 축</b> 내부 표면 (GROMO-2232) — {@code /screens/home} 의 {@code layoutRevision}·
 * {@code layout} 조각의 상류다. 주체는 {@code InternalAuthFilter} 가 검증한 {@code X-User-Id} 하나다.
 *
 * <p>건설·섬 컨트롤러와 따로 둔다 — 두 컨트롤러의 매핑 수를 허용목록 테스트가 고정하고 있다.
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandLayoutController {

    private final IslandConstructionService construction;

    /** 배치 조회 — 활성 주민 전용. 행이 없는 섬은 이 조회가 기본 템플릿으로 만든다. */
    @GetMapping("/internal/islands/{islandId}/layout")
    public IslandLayoutView layout(@PathVariable UUID islandId,
                                   @RequestHeader("X-User-Id") UUID userId) {
        return construction.layout(islandId, userId);
    }
}
