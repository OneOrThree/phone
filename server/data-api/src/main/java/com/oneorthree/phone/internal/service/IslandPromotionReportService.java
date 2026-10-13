package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.internal.dto.MagazineViews;
import com.oneorthree.phone.magazine.exception.MagazineErrorCode;
import com.oneorthree.phone.magazine.exception.MagazineException;
import com.oneorthree.phone.magazine.repository.IslandPromotionReportRepository;
import com.oneorthree.phone.magazine.repository.IslandPromotionRepository;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * 잡지 홍보 칸 신고 (GROMO-2289, 잡지 구현 계획 §3-10·§8-4, SAFE-04) — 서로 다른 사람 3명이 신고하면 그 칸을 모든 독자에게서
 * 즉시 숨긴다. 운영 사전 검토는 없고(10/14 확정), 숨겨진 칸은 운영이 SQL 로 확인해 내리거나(REMOVED, 물고기는 돌려주지
 * 않는다) 되살린다(CLEARED, 이후 자동 숨김 없음).
 *
 * <h2>세는 순서</h2>
 * 홍보 행을 배타로 잠그고 → 신고 행을 넣고(같은 사람의 두 번째는 아무것도 하지 않는다) → 신고 수를 센다. 같은 칸의 신고가
 * 잠금에서 줄을 서므로, 뒤에 선 쪽은 앞선 신고가 커밋된 뒤에 세어 3건째를 놓치지 않는다. 신고는 드물어 줄을 서도 괜찮다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IslandPromotionReportService {

    /** 숨김 기준 — 서로 다른 사람의 신고 수(정본 153행). */
    static final int HIDE_THRESHOLD = 3;

    private final UserQueryService users;
    private final MagazineIssueRepository issues;
    private final IslandPromotionRepository promotions;
    private final IslandPromotionReportRepository reports;
    private final Clock clock;

    /**
     * 신고 — 소셜 로그인 계정만(게스트는 컨트롤러가 403). 대상은 최근 7호에 실린 칸이고 그 섬의 것이어야 한다(아니면 404
     * {@code PROMOTION_NOT_FOUND}). 이미 숨겨졌거나 내려간 칸의 신고도 받는다 — 결과는 같다.
     *
     * @return {@code created} = 이번에 새로 남긴 신고인가
     */
    @Transactional
    public MagazineViews.Reported report(UUID userId, UUID islandId, UUID promotionId,
                                         MagazineViews.ReportReason reason) {
        users.getCaller(userId);
        IslandPromotion promotion = promotions.findForUpdate(promotionId)
                .filter(row -> row.getIslandId().equals(islandId) && row.getSnapshot() != null && inLatestSeven(row))
                .orElseThrow(() -> new MagazineException(MagazineErrorCode.PROMOTION_NOT_FOUND));
        Instant now = clock.instant();
        boolean created = reports.insertIfAbsent(promotion.getId(), userId, reason.name(), now) == 1;
        if (created && reports.countByPromotionId(promotion.getId()) >= HIDE_THRESHOLD
                && promotion.hideByReports(now)) {
            log.warn("promotion hidden id={} island={} — 신고 {}건, 운영 확인이 필요하다",
                    promotion.getId(), islandId, HIDE_THRESHOLD);
        }
        return new MagazineViews.Reported(true, created);
    }

    private boolean inLatestSeven(IslandPromotion promotion) {
        return issues.findTop7ByOrderByIssueNoDesc().stream().map(MagazineIssue::getIssueDate)
                .anyMatch(promotion.getIssueDate()::equals);
    }
}
