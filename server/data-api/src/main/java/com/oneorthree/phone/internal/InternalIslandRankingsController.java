package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandRankingViews;
import com.oneorthree.phone.internal.service.IslandRankingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 주간 섬 랭킹의 내부 표면 (GROMO-1997, island-rankings LLD) — 공개 {@code GET /rankings/islands} 의 상류다.
 *
 * <p>경로가 <b>사용자 축</b>인 것은 B26 규칙이다 — 이 조회에는 경로 섬이 없고, 「요청자의 현재 섬 전망대에서
 * 보는 전체 섬 순위」라 주체가 곧 범위다. 1759 의 {@code /internal/users/{userId}/island-search}·
 * {@code /island-discovery} 와 같은 자리다.
 *
 * <p>{@code week} 는 <b>주 시작일</b>({@code YYYY-MM-DD} 인 UTC 일요일)이다. 형식·limit 범위는 Business 가
 * 검증했고, 달력 의미(일요일인가·아직 오지 않은 주인가)와 전망대·주민 판정은 Data 몫이다.
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandRankingsController {

    private final IslandRankingsService rankings;

    @GetMapping("/internal/users/{userId}/island-rankings")
    public IslandRankingViews.IslandRankingPage islands(@PathVariable UUID userId,
                                                        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                                                        LocalDate week,
                                                        @RequestParam(required = false) Integer limit) {
        return rankings.islands(userId, week, limit);
    }
}
