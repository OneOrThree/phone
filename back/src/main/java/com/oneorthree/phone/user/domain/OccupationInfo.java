package com.oneorthree.phone.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * occupation 마스터 테이블 (하이브리드).
 *
 * <p>{@link Occupation} enum 은 그대로 유지하고, 그 값셋에 표시명·정렬 순서 등 메타데이터를 얹는
 * 마스터 행. {@code users.occupation} 과 {@code occupation_default_tags.occupation} 이 이 테이블의
 * {@code code} 를 FK 로 참조한다(무결성 보강). enum 저장 관례({@code @Enumerated(STRING)})와 동일하게
 * PK({@code code}) 에 enum name 문자열이 저장되므로 기존 컬럼값(전부 5개 enum 값 or null)과 그대로 정합.
 *
 * <p>표시명은 그동안 앱에서 매핑하던 것을 서버 소스오브트루스로 옮긴 것 — {@code GET /api/v1/occupations}
 * 로 노출한다. 시드 교체 여지를 위해 소프트 딜리트({@code deletedAt}) 컬럼을 둔다.
 */
@Entity
@Table(name = "occupations")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class OccupationInfo {

    // enum 을 PK 로 — @Enumerated(STRING) 로 code 컬럼에 enum name 저장 (users.occupation 과 동일 표현).
    @Id
    @Enumerated(EnumType.STRING)
    @Column(name = "code")
    private Occupation code;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;
}
