package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandFocusMembersView;
import com.oneorthree.phone.internal.dto.IslandRestMembersView;
import com.oneorthree.phone.internal.service.IslandFocusMembersService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 「같이 낚시」 초기 스냅샷 2종의 내부 표면 (GROMO-1765) — 공개 {@code GET /islands/{islandId}/focus-members}
 * · {@code /rest-members} 의 상류다.
 *
 * <p>{@code InternalIslandConstructionController} 와 같은 {@code /internal/islands/{islandId}} 축이고, 주체는
 * {@code InternalAuthFilter} 가 서비스 토큰과 함께 검증한 {@code X-User-Id} 헤더로만 받는다. 응답은
 * {@code {"data": …}} 로 감싸지 않는다 — 봉투는 Business 몫이다.
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandFocusMembersController {

    private final IslandFocusMembersService islandFocusMembersService;

    @GetMapping("/internal/islands/{islandId}/focus-members")
    public IslandFocusMembersView focusMembers(@PathVariable UUID islandId,
                                               @RequestHeader("X-User-Id") UUID userId) {
        return islandFocusMembersService.focusMembers(islandId, userId);
    }

    @GetMapping("/internal/islands/{islandId}/rest-members")
    public IslandRestMembersView restMembers(@PathVariable UUID islandId,
                                             @RequestHeader("X-User-Id") UUID userId) {
        return islandFocusMembersService.restMembers(islandId, userId);
    }
}
