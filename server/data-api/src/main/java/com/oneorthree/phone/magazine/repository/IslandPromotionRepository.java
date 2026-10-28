package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 잡지 홍보 칸 (GROMO-2289, V119). */
public interface IslandPromotionRepository extends JpaRepository<IslandPromotion, UUID> {

    Optional<IslandPromotion> findByIdAndIslandId(UUID id, UUID islandId);

    Optional<IslandPromotion> findByIslandIdAndIssueDate(UUID islandId, LocalDate issueDate);

    /** {@code issueDate} 보다 앞선 호 중 가장 최근 칸 — 「지난번에 실은 칸」. {@code (island_id, issue_date)} 유니크 인덱스를 탄다. */
    Optional<IslandPromotion> findFirstByIslandIdAndIssueDateLessThanOrderByIssueDateDesc(UUID islandId,
                                                                                         LocalDate issueDate);

    /** 그 호에 신청된 칸 전부 — 지면 순서(먼저 신청한 순). 발행 배치가 읽는다. */
    List<IslandPromotion> findByIssueDateOrderByAppliedAtAscIdAsc(LocalDate issueDate);

    /**
     * 그 호에 실린 칸 중 <b>지금 보여 줄 수 있는</b> 것 한 페이지 — {@code (applied_at, id)} keyset, 지면 순서.
     *
     * <p>읽는 순간 빼는 칸: 발행 때 싣지 않은 칸(snapshot 없음), 신고로 숨겨졌거나 내려간 칸, 지금 닫힌 섬의
     * 칸(10/16: 비공개 섬의 칸은 보인다). 그래서 숨김이 «모든 독자에게서 즉시» 다. 첫 페이지는 호출측이
     * 어떤 행보다도 이른 경계({@code Instant.EPOCH})를 넘긴다.
     */
    @Query("SELECT p FROM IslandPromotion p, Group g WHERE g.id = p.islandId AND p.issueDate = :issueDate "
            + "AND p.snapshot IS NOT NULL AND p.moderation IN ('NONE', 'CLEARED') "
            + "AND g.deletedAt IS NULL "
            + "AND g.status <> com.oneorthree.phone.group.repository.domain.GroupStatus.ENDED "
            + "AND (p.appliedAt > :afterAppliedAt OR (p.appliedAt = :afterAppliedAt AND p.id > :afterId)) "
            + "ORDER BY p.appliedAt, p.id")
    List<IslandPromotion> findVisiblePage(@Param("issueDate") LocalDate issueDate,
                                          @Param("afterAppliedAt") Instant afterAppliedAt,
                                          @Param("afterId") UUID afterId, Pageable page);

    /** 신고가 숨김 판정 전에 잡는 배타 잠금 — 같은 칸의 신고를 줄 세워 3건째를 놓치지 않게 한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM IslandPromotion p WHERE p.id = :id")
    Optional<IslandPromotion> findForUpdate(@Param("id") UUID id);
}
