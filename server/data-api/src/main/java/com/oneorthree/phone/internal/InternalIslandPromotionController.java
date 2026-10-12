package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandPromotionViews;
import com.oneorthree.phone.internal.service.GuestAccountGuards;
import com.oneorthree.phone.internal.service.IslandPromotionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 잡지 홍보 신청·섬 소식의 Data 내부 표면 (GROMO-2267) — 공개 {@code POST /islands/{islandId}/promotions}·
 * {@code GET /islands/{islandId}/news} 의 상류다. 본인 명령이라 사용자 축이다({@code InternalAuthFilter} 가 경로의
 * userId 와 {@code X-User-Id} 의 일치를 강제한다).
 *
 * <p>게스트는 신청 앞에서 막는다 — {@code publicCommands.run} <b>앞</b> 이라 거절된 게스트는 멱등 receipt 를 남기지
 * 않는다(상점 구매와 같다). 소식 읽기는 막지 않는다.
 */
@RestController
@RequestMapping("/internal/users/{userId}/islands/{islandId}")
@RequiredArgsConstructor
public class InternalIslandPromotionController {

    private final IslandPromotionService promotions;
    private final GuestAccountGuards guestAccountGuards;

    @PostMapping("/promotions")
    @ResponseStatus(HttpStatus.CREATED)
    public IslandPromotionViews.Created promote(@PathVariable UUID userId, @PathVariable UUID islandId,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        guestAccountGuards.requireMember(userId);
        return promotions.promote(userId, islandId, idempotencyKey);
    }

    @GetMapping("/news")
    public IslandPromotionViews.NewsPage news(@PathVariable UUID userId, @PathVariable UUID islandId,
            @RequestParam(defaultValue = "20") int limit) {
        return promotions.news(userId, islandId, limit);
    }
}
