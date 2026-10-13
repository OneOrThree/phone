package com.oneorthree.phone.magazine.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.magazine.support.PromotionContent;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 섬장이 신청한 잡지 홍보 한 건 (GROMO-2289, V114) — 한 섬은 한 호에 한 칸이다({@code UNIQUE (island_id, issue_date)}).
 * 발행 때 채우는 {@code snapshot}·신고 숨김 시각 {@code hidden_at} 은 발행·신고 쪽이 매핑한다.
 */
@Entity
@Table(name = "island_promotions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandPromotion {

    /** 운영이 신고를 확인하고 내린 칸 — 다시 불러올 때 글을 비운다. */
    public static final String MODERATION_REMOVED = "REMOVED";

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "island_id", nullable = false, updatable = false)
    private UUID islandId;

    /** 실릴 호의 KST 날짜. */
    @Column(name = "issue_date", nullable = false, updatable = false)
    private LocalDate issueDate;

    @Column(name = "applied_by", nullable = false, updatable = false)
    private UUID appliedBy;

    /** 지면 순서의 기준 — 고쳐도 바뀌지 않는다. */
    @Column(name = "applied_at", nullable = false, updatable = false)
    private Instant appliedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(nullable = false, length = PromotionContent.MAX_BODY_LENGTH)
    private String body;

    /** 검증을 마친 정규형 배치. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private PromotionContent.Layout layout;

    /** 신고 숨김 상태 — NONE · HIDDEN · REMOVED · CLEARED(V114 CHECK). */
    @Column(nullable = false, length = 10)
    private String moderation = "NONE";

    /** 신청 — 검증을 마친 내용만 받는다. */
    public IslandPromotion(UUID islandId, LocalDate issueDate, UUID appliedBy, PromotionContent content,
                           Instant now) {
        this.islandId = islandId;
        this.issueDate = issueDate;
        this.appliedBy = appliedBy;
        this.appliedAt = now;
        this.updatedAt = now;
        this.body = content.body();
        this.layout = content.layout();
    }

    /** 신청 창 안의 고치기 — 지면 순서({@code appliedAt})는 그대로다. */
    public void edit(PromotionContent content, Instant now) {
        this.body = content.body();
        this.layout = content.layout();
        this.updatedAt = now;
    }

    public boolean isRemoved() {
        return MODERATION_REMOVED.equals(moderation);
    }
}
