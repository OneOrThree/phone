package com.oneorthree.phone.internal;

import com.oneorthree.phone.appearance.dto.AppearanceCommandView;
import com.oneorthree.phone.appearance.dto.PlaybackView;
import com.oneorthree.phone.appearance.service.IslandPlaybackService;
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
 * 공용 음악(방송기)의 내부 표면 (GROMO-1779) — 공개 {@code GET·PATCH /islands/{islandId}/playback}
 * 의 상류다. 주체는 {@code X-User-Id} 헤더다.
 *
 * <p>PATCH 본문은 외양과 같은 tri-state 캐리어({@link AppearancePatchRequest})다 — 필드 부재(유지)와
 * 명시 null(400)을 구분해야 하므로 제출된 필드만 fields·values 로 넘긴다.
 */
@RestController
@RequiredArgsConstructor
public class InternalPlaybackController {

    private final IslandPlaybackService playback;

    /** 재생 상태 — 활성 주민 + 방송기 완공. 행이 없으면 초기 상태(곡 없음·정지·0초·version 0). */
    @GetMapping("/internal/islands/{islandId}/playback")
    public PlaybackView get(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId) {
        return playback.get(islandId, userId);
    }

    /** 재생 변경 — 같은 섬 주민 누구나, expectedVersion 낙관 검사. 같은 키의 재생은 receipt 를 돌려준다. */
    @PatchMapping("/internal/islands/{islandId}/playback")
    public AppearanceCommandView<PlaybackView> patch(
            @PathVariable UUID islandId,
            @RequestHeader("X-User-Id") UUID userId,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey,
            @RequestBody AppearancePatchRequest body) {
        return playback.patch(islandId, userId, idempotencyKey,
                body.fields(), body.values(), body.expectedVersion());
    }
}
