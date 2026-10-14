package com.oneorthree.phone.magazine.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 편집부 소식 — 운영이 SQL 로 날짜별 문구를 넣는다(GROMO-2289, V120, OPS-04). 발행 배치가 그날 행을 읽기만 한다.
 */
@Entity
@Table(name = "magazine_editorial_notes")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MagazineEditorialNote {

    @Id
    @Column(name = "issue_date")
    private LocalDate issueDate;

    @Column(nullable = false, length = 80)
    private String body;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
