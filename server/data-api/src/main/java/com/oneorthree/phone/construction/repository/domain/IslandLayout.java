package com.oneorthree.phone.construction.repository.domain;

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
import java.util.Map;
import java.util.UUID;

/**
 * 섬 배치 정본 — 섬당 한 행 (GROMO-2232, map-assets §6).
 *
 * <p>행은 {@code IslandLayoutRepository#insertIfAbsent} 가 기본 템플릿으로만 만든다(백필 없음).
 * {@code layoutRevision} 은 섬 단위 단조 정수라 내려가지 않는다.
 */
@Entity
@Table(name = "island_layouts")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandLayout {

    @Id
    @Column(name = "island_id")
    private UUID islandId;

    @Column(name = "layout_revision", nullable = false)
    private long layoutRevision;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Object> layout;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** 배치가 바뀌었다(지금은 시설 완공뿐) — revision 을 1 올린다. */
    public long bump(Instant now) {
        this.layoutRevision += 1;
        this.updatedAt = now;
        return layoutRevision;
    }
}
