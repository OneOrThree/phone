package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandFishEarningsView;
import com.oneorthree.phone.internal.dto.IslandLedgerPageView;
import com.oneorthree.phone.internal.service.IslandEconomyReadService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.YearMonth;
import java.util.UUID;

/**
 * 섬 공동 경제 읽기 2종의 내부 표면 (GROMO-1895) — 공개 {@code GET /islands/{islandId}/resources/ledger}
 * (섬 건설 LLD §6)·{@code GET /islands/{islandId}/statistics/fish-earnings}(회관 기록 LLD §7)의 상류다.
 *
 * <p>경로는 B26 규칙({@code /internal} + 공개 경로)이고 주체는 {@code InternalAuthFilter} 가 검증한
 * {@code X-User-Id} 다. 가계부 커서는 Business 가 서명·검증한 뒤 평문 keyset 경계({@code after…})만 넘긴다.
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandEconomyController {

    private final IslandEconomyReadService economy;

    /** 공동 가계부 — {@code month=YYYY-MM}(KST) 필수, {@code direction=earn|spend} 선택. 최신순. */
    @GetMapping("/internal/islands/{islandId}/resources/ledger")
    public IslandLedgerPageView ledger(@PathVariable UUID islandId,
                                       @RequestHeader("X-User-Id") UUID userId,
                                       @RequestParam @DateTimeFormat(pattern = "yyyy-MM") YearMonth month,
                                       @RequestParam(required = false) String direction,
                                       @RequestParam(required = false)
                                       @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant afterCreatedAt,
                                       @RequestParam(required = false) UUID afterEntryId,
                                       @RequestParam int limit) {
        return economy.ledger(userId, islandId, month, direction, afterCreatedAt, afterEntryId, limit);
    }

    /** 주민별 누적 획득 물고기 — 도서관 완공 섬만. 주민 전원을 한 번에 싣는다. */
    @GetMapping("/internal/islands/{islandId}/statistics/fish-earnings")
    public IslandFishEarningsView fishEarnings(@PathVariable UUID islandId,
                                               @RequestHeader("X-User-Id") UUID userId) {
        return economy.fishEarnings(userId, islandId);
    }
}
