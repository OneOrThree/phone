package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.magazine.repository.IslandPromotionRepository;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 망원경 핀의 홍보 칸 미리보기 — 현재 호에 보이는 칸인지 읽기만 한다. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MagazinePinService {

    private final MagazineIssueRepository issues;
    private final IslandPromotionRepository promotions;

    /** 가장 최근 호이면서 다음 날 07:00 KST 전인 호. */
    public Optional<MagazineIssue> currentIssue(Instant now) {
        return issues.findFirstByOrderByIssueNoDesc()
                .filter(issue -> now.isBefore(MagazineCalendar.currentUntil(issue.getIssueDate())));
    }

    /** 이 섬의 현재 호 홍보 칸일 때만 핀에 미리보기 연결을 남긴다. */
    public boolean isVisiblePromotion(UUID islandId, UUID promotionId, Instant now) {
        return currentIssue(now)
                .flatMap(issue -> promotions.findByIdAndIslandId(promotionId, islandId)
                        .filter(promotion -> promotion.getIssueDate().equals(issue.getIssueDate())
                                && promotion.isShown()))
                .isPresent();
    }
}
