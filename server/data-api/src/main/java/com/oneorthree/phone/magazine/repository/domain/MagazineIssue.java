package com.oneorthree.phone.magazine.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.magazine.support.MagazineEditorial;
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
 * 고양이 잡지 한 호 (GROMO-2289, V115) — 하루 한 행, 발행 배치만 만든다. 만든 뒤 바뀌지 않는다.
 */
@Entity
@Table(name = "magazine_issues")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MagazineIssue {

    /** 조간(07시) — 조간·석간 전환 전에는 이것 하나다. */
    public static final String SLOT_MORNING = "MORNING";

    @Id
    @GeneratedUuidV7
    private UUID id;

    /** 호의 KST 날짜. */
    @Column(name = "issue_date", nullable = false, updatable = false)
    private LocalDate issueDate;

    @Column(nullable = false, length = 10, updatable = false)
    private String slot = SLOT_MORNING;

    /** 호수 — 1호부터. */
    @Column(name = "issue_no", nullable = false, updatable = false)
    private int issueNo;

    @Column(name = "published_at", nullable = false, updatable = false)
    private Instant publishedAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, updatable = false)
    private MagazineEditorial editorial;

    /** 실린 홍보 수 — 조간·석간 전환 판단용. */
    @Column(name = "promotion_count", nullable = false, updatable = false)
    private int promotionCount;

    public MagazineIssue(LocalDate issueDate, int issueNo, Instant publishedAt, MagazineEditorial editorial,
                         int promotionCount) {
        this.issueDate = issueDate;
        this.issueNo = issueNo;
        this.publishedAt = publishedAt;
        this.editorial = editorial;
        this.promotionCount = promotionCount;
    }
}
