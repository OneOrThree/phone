package com.oneorthree.phone.magazine.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.magazine.support.IslandCard;
import com.oneorthree.phone.magazine.support.PromotionContent;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 섬장이 신청한 잡지 홍보 한 건 (GROMO-2289, V119) — 한 섬은 한 호에 한 칸이다({@code UNIQUE (island_id, issue_date)}).
 *
 * <h2>{@code @DynamicUpdate} 가 붙어 있는 이유</h2>
 * 이 행에는 서로 다른 트랜잭션이 고치는 열이 함께 산다 — 발행 배치는 {@code snapshot} 을, 신고는 {@code moderation}·
 * {@code hidden_at} 을, 섬장은 글·배치를 고친다. 기본 더티 체킹은 전 열 UPDATE 를 내므로, 발행이 칸을 읽은 뒤 신고가
 * 숨김을 커밋하면 발행의 UPDATE 가 읽어 둔 {@code moderation} 으로 숨김을 되돌릴 수 있다. 바뀐 열만 쓰게 해 서로의 열을
 * 덮지 않는다({@code GroupMember} 와 같은 이유).
 */
@Entity
@DynamicUpdate
@Table(name = "island_promotions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandPromotion {

    /** 신고 없음 — 그대로 보인다. */
    public static final String MODERATION_NONE = "NONE";
    /** 신고 3건으로 숨김 — 운영 확인을 기다린다. */
    public static final String MODERATION_HIDDEN = "HIDDEN";
    /** 운영이 신고를 확인하고 내린 칸 — 다시 불러올 때 글을 비운다. */
    public static final String MODERATION_REMOVED = "REMOVED";
    /** 운영이 되살린 칸 — 다시 자동으로 숨기지 않는다. */
    public static final String MODERATION_CLEARED = "CLEARED";

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

    /**
     * 발행 때 고정한 섬 숫자. 발행 전 null — 발행 배치가 이 칸을 싣지 않았으면(그 순간 비공개·닫힌 섬) 호가 나온 뒤에도
     * null 로 남는다(기록판의 「실리지 않음」).
     */
    @JdbcTypeCode(SqlTypes.JSON)
    private IslandCard snapshot;

    /** 신고 숨김 상태 — NONE · HIDDEN · REMOVED · CLEARED(V119 CHECK). */
    @Column(nullable = false, length = 10)
    private String moderation = MODERATION_NONE;

    /** 신고로 숨긴 시각. */
    @Column(name = "hidden_at")
    private Instant hiddenAt;

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

    /** 발행 — 그 순간의 섬 숫자를 칸에 고정한다. 글·배치는 00시 마감으로 이미 굳어 있다. */
    public void publish(IslandCard card) {
        this.snapshot = card;
    }

    public boolean isRemoved() {
        return MODERATION_REMOVED.equals(moderation);
    }

    /** 발행됐고 숨김·내림이 아니라 독자에게 보이는 칸인가(섬의 공개 여부는 따로 본다). */
    public boolean isShown() {
        return snapshot != null && (MODERATION_NONE.equals(moderation) || MODERATION_CLEARED.equals(moderation));
    }

    /**
     * 신고가 쌓였을 때 숨긴다 — 신고 없음 상태에서만. 운영이 되살린 칸(CLEARED)은 다시 자동으로 숨기지 않는다.
     *
     * @return 이번에 숨겼으면 true
     */
    public boolean hideByReports(Instant now) {
        if (!MODERATION_NONE.equals(moderation)) {
            return false;
        }
        moderation = MODERATION_HIDDEN;
        hiddenAt = now;
        return true;
    }
}
