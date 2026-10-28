package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.MagazineViews;
import com.oneorthree.phone.internal.service.MagazineIssueService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * 고양이 잡지 읽기·받음 상태의 Data 내부 표면 (GROMO-2289) — 공개 {@code GET /me/magazine/today}·{@code GET
 * /me/magazine/issues}·{@code GET /me/magazine/issues/{issueId}}·{@code PUT /me/magazine/issues/{issueId}/receipt} 의
 * 상류다. 본인 조회·기록이라 사용자 축이고 게스트도 읽는다(SAFE-01). 커서 서명은 Business 몫이고 여기는 평문 keyset
 * 경계({@code afterAppliedAt}·{@code afterPromotionId})를 받는다.
 */
@RestController
@RequestMapping("/internal/users/{userId}/magazine")
@RequiredArgsConstructor
public class InternalMagazineController {

    private final MagazineIssueService magazine;

    @GetMapping("/today")
    public MagazineViews.Today today(@PathVariable UUID userId) {
        return magazine.today(userId);
    }

    @GetMapping("/issues")
    public MagazineViews.Shelf shelf(@PathVariable UUID userId) {
        return magazine.shelf(userId);
    }

    @GetMapping("/issues/{issueId}")
    public MagazineViews.IssuePage issue(@PathVariable UUID userId, @PathVariable UUID issueId,
            @RequestParam(required = false) Instant afterAppliedAt,
            @RequestParam(required = false) UUID afterPromotionId, @RequestParam(defaultValue = "30") int limit) {
        return magazine.issue(userId, issueId, afterAppliedAt, afterPromotionId, limit);
    }

    @PutMapping("/issues/{issueId}/receipt")
    public MagazineViews.Receipt receive(@PathVariable UUID userId, @PathVariable UUID issueId,
            @Valid @RequestBody MagazineViews.ReceiptRequest request) {
        return magazine.receive(userId, issueId, request);
    }
}
