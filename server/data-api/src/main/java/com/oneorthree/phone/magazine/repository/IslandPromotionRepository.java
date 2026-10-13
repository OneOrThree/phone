package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/** 잡지 홍보 칸 (GROMO-2289, V114). */
public interface IslandPromotionRepository extends JpaRepository<IslandPromotion, UUID> {

    Optional<IslandPromotion> findByIdAndIslandId(UUID id, UUID islandId);

    Optional<IslandPromotion> findByIslandIdAndIssueDate(UUID islandId, LocalDate issueDate);

    /** {@code issueDate} 보다 앞선 호 중 가장 최근 칸 — 「지난번에 실은 칸」. {@code (island_id, issue_date)} 유니크 인덱스를 탄다. */
    Optional<IslandPromotion> findFirstByIslandIdAndIssueDateLessThanOrderByIssueDateDesc(UUID islandId,
                                                                                         LocalDate issueDate);
}
