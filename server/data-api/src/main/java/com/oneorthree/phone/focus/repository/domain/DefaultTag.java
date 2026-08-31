package com.oneorthree.phone.focus.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 글로벌 태그 마스터 (default_tags).
 *
 * <p>태그의 정체성(name)을 담는 재사용/인덱싱 단위다. 공부 과목 시드 + 유저가 커스텀으로 만든 태그 모두
 * 이 테이블에 name 단위로 유일하게 등록되며, {@link UserFocusTag} 와 {@link OccupationDefaultTag} 가
 * 이 행을 FK 로 참조한다. name 은 전역 유일(중복 제거)이라 여러 유저·여러 occupation 이 같은 태그를 공유한다.
 *
 * <p>마스터 시드 데이터이므로 소프트 딜리트 컬럼을 두지 않는다(태그 세트 교체는 마이그레이션 시드로 처리).
 */
@Entity
@Table(name = "default_tags")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class DefaultTag {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /**
     * 전역 유일 — 같은 name 은 하나의 마스터 행으로만 존재(중복 제거). 검색/인덱스 키.
     */
    @Column(nullable = false, unique = true)
    private String name;

    @CreationTimestamp
    private Instant createdAt;
}
