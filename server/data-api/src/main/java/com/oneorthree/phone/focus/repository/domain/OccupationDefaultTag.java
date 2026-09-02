package com.oneorthree.phone.focus.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.Occupation;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
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
 * occupation별 기본(추천) 포커스 태그 마스터 테이블.
 *
 * <p>유저 소유 태그({@link UserFocusTag})와 달리 특정 유저와 FK 관계가 없는 읽기 전용 시드 데이터다.
 * 태그의 정체성(name)은 마스터({@link DefaultTag})에 있으므로 이 행은 name 을 직접 갖지 않고
 * {@code default_tag_id} FK 로 참조한다(occupation ⇄ default_tags 교차 매핑). 온보딩/태그 초기 설정
 * 화면에서 occupation 에 맞는 추천 태그를 노출하는 용도이며, 유저가 선택하면 {@link UserFocusTag} 로 채택된다.
 *
 * <p>{@link UserFocusTag} 의 {@code sourceOccupationDefaultTag} 가 이 행을 참조할 수 있으나 소프트 딜리트 컬럼은
 * 두지 않는다(태그 세트 교체는 마이그레이션 시드로 처리).
 */
@Entity
@Table(name = "occupation_default_tags")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class OccupationDefaultTag {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /**
     * FK 아님 — users.occupation 과 동일 값셋(Enum)을 재사용. 저장은 문자열(EnumType.STRING)로 users 와 동일 매핑.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Occupation occupation;

    /**
     * 태그 정체성 — 마스터(default_tags) 참조. name 은 여기서 조회(태그 정규화, GROMO-673).
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "default_tag_id", nullable = false)
    private DefaultTag defaultTag;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @CreationTimestamp
    private Instant createdAt;
}
