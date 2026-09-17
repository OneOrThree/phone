package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandViewResponse;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 섬 하나를 보는 <b>섬 축</b> 내부 표면 (GROMO-1759) — 공개 {@code GET /islands/{islandId}} 의 상류다.
 *
 * <p>자원이 섬이라 {@code InternalHostTransferController} 와 같은 {@code /internal/islands/{islandId}}
 * 축을 쓴다. 이 축에는 클래스 수준 {@code @RequestMapping} 을 두지 않는 것이 기존 관례다.
 *
 * <p><b>범위 분기를 요청이 고를 수 없다.</b> 이 서명에는 {@code role}·{@code isMember} 같은 파라미터가
 * 아예 없고 주체는 {@code X-User-Id} 하나다 — 그 헤더는 {@code InternalAuthFilter} 가 서비스 토큰과
 * 함께 검증한 값이며, Business 는 앱이 보낸 동명 헤더를 버리고 서명된 토큰의 주체로 덮어쓴다.
 * 주민/방문자 판정은 오직 DB 의 활성 membership 으로 한다(LLD §3.4).
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandController {

    private final IslandMembershipService islandMembershipService;

    /** 섬 상세/공개 요약 (LLD §3.4). 종료·삭제는 404, 비공개 비소속은 403 이다. */
    @GetMapping("/internal/islands/{islandId}")
    public IslandViewResponse view(@PathVariable UUID islandId,
                                   @RequestHeader("X-User-Id") UUID userId) {
        return islandMembershipService.view(islandId, userId);
    }
}
