package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandPromotionViews;
import com.oneorthree.phone.internal.dto.MagazineViews;
import com.oneorthree.phone.internal.service.GuestAccountGuards;
import com.oneorthree.phone.internal.service.IslandPromotionReportService;
import com.oneorthree.phone.internal.service.IslandPromotionService;
import com.oneorthree.phone.internal.service.MagazineFunnelService;
import com.oneorthree.phone.magazine.support.PromotionContent;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * 잡지 홍보·꾸미기 재료·섬 소식의 Data 내부 표면 (GROMO-2267 · GROMO-2289) — 공개
 * {@code POST·PUT /islands/{islandId}/promotions…}·{@code GET /islands/{islandId}/promotions/editor}·
 * {@code GET /me/magazine/assets}·{@code GET /islands/{islandId}/news} 의 상류다. 본인 명령·조회라 사용자 축이다
 * ({@code InternalAuthFilter} 가 경로의 userId 와 {@code X-User-Id} 의 일치를 강제한다).
 *
 * <p>게스트는 신청·고치기·쓰기 화면 앞에서 막는다 — 신청은 {@code publicCommands.run} <b>앞</b> 이라 거절된 게스트는
 * 멱등 receipt 를 남기지 않는다(상점 구매와 같다). 쓰기 화면을 여는 순간 막아야 꾸민 뒤에 막히지 않는다. 재료 목록과
 * 소식 읽기는 막지 않는다.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalIslandPromotionController {

    private final IslandPromotionService promotions;
    private final IslandPromotionReportService reports;
    private final MagazineFunnelService funnel;
    private final GuestAccountGuards guestAccountGuards;

    @PostMapping("/islands/{islandId}/promotions")
    @ResponseStatus(HttpStatus.CREATED)
    public IslandPromotionViews.Created promote(@PathVariable UUID userId, @PathVariable UUID islandId,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey, @RequestBody Map<String, Object> body) {
        guestAccountGuards.requireMember(userId);
        return promotions.promote(userId, islandId, idempotencyKey, PromotionContent.from(body));
    }

    @PutMapping("/islands/{islandId}/promotions/{promotionId}")
    public IslandPromotionViews.Updated update(@PathVariable UUID userId, @PathVariable UUID islandId,
            @PathVariable UUID promotionId, @RequestBody Map<String, Object> body) {
        guestAccountGuards.requireMember(userId);
        return promotions.update(userId, islandId, promotionId, PromotionContent.from(body));
    }

    @GetMapping("/islands/{islandId}/promotions/editor")
    public IslandPromotionViews.Editor editor(@PathVariable UUID userId, @PathVariable UUID islandId) {
        guestAccountGuards.requireMember(userId);
        return promotions.editor(userId, islandId);
    }

    /**
     * 홍보 칸 신고 (GROMO-2289) — 새 신고 201, 이미 신고함 200, 본문은 같다. 소셜 로그인 계정만 — 게스트 계정으로 경쟁 섬 칸을
     * 숨기는 악용을 막는다(계획 P10).
     */
    @PostMapping("/islands/{islandId}/promotions/{promotionId}/reports")
    public ResponseEntity<MagazineViews.Reported> report(@PathVariable UUID userId, @PathVariable UUID islandId,
            @PathVariable UUID promotionId, @Valid @RequestBody MagazineViews.ReportRequest body) {
        guestAccountGuards.requireMember(userId);
        MagazineViews.Reported reported = reports.report(userId, islandId, promotionId,
                MagazineViews.ReportReason.valueOf(body.reason()));
        return ResponseEntity.status(reported.created() ? HttpStatus.CREATED : HttpStatus.OK).body(reported);
    }

    /** 회관 홍보 기록판 (GROMO-2289) — 주민만, 게스트 주민도 읽는다. */
    @GetMapping("/islands/{islandId}/promotions/records")
    public MagazineViews.RecordPage records(@PathVariable UUID userId, @PathVariable UUID islandId,
            @RequestParam(defaultValue = "20") int limit) {
        return funnel.records(userId, islandId, limit);
    }

    @GetMapping("/magazine/assets")
    public IslandPromotionViews.Assets assets(@PathVariable UUID userId) {
        return promotions.assets(userId);
    }

    @GetMapping("/islands/{islandId}/news")
    public IslandPromotionViews.NewsPage news(@PathVariable UUID userId, @PathVariable UUID islandId,
            @RequestParam(defaultValue = "20") int limit) {
        return promotions.news(userId, islandId, limit);
    }
}
