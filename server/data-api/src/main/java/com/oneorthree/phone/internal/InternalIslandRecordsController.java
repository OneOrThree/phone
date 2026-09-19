package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandRecordViews;
import com.oneorthree.phone.internal.service.IslandRecordsService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 회관 기록(도서관) 통계 3종의 내부 표면 (GROMO-1769, island-records LLD) — 공개
 * {@code GET /islands/{islandId}/statistics/focus|screen-time} · {@code PUT /me/screen-time/{date}} 의 상류다.
 *
 * <p>경로는 B26 규칙이다 — 섬 자원은 {@code /internal} + 공개 경로, 본인 명령은 사용자 축. 날짜는 UTC 버킷이고
 * 형식·범위·scope·timezone 은 Business 가 검증했다. 집중 다음 페이지는 Business 가 서명 커서에서 꺼낸
 * 스냅샷 id·offset 평문으로 온다.
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandRecordsController {

    private final IslandRecordsService records;

    @GetMapping("/internal/islands/{islandId}/statistics/focus")
    public IslandRecordViews.FocusStatistics focus(@PathVariable UUID islandId,
                                                   @RequestHeader("X-User-Id") UUID userId,
                                                   @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                                                   LocalDate from,
                                                   @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                                                   LocalDate to,
                                                   @RequestParam String scope,
                                                   @RequestParam(required = false) UUID snapshotId,
                                                   @RequestParam(required = false) Integer offset) {
        return records.focus(userId, islandId, from, to, scope, snapshotId, snapshotId == null ? 0 : offset);
    }

    @GetMapping("/internal/islands/{islandId}/statistics/screen-time")
    public IslandRecordViews.ScreenTimeStatistics screenTime(
            @PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam String scope) {
        return records.screenTime(userId, islandId, from, to, scope);
    }

    /** 세션·세대는 서명된 AT 에서만 오고, 측정 기기 = 이 세션인지 Data 가 판정한다. */
    @PutMapping("/internal/users/{userId}/screen-time/{date}")
    public IslandRecordViews.ScreenTimeDay putScreenTime(@PathVariable UUID userId,
                                                         @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                                                         LocalDate date,
                                                         @RequestHeader("X-Session-Id") UUID sessionId,
                                                         @RequestHeader("X-Auth-Generation") long authGeneration,
                                                         @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                                         @RequestBody IslandRecordViews.ScreenTimeUpload body) {
        return records.putScreenTime(userId, sessionId, authGeneration, date, body, idempotencyKey);
    }
}
