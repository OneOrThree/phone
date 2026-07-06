package com.oneorthree.phone.focus.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.domain.Occupation;
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
import java.util.UUID;

/**
 * occupation별 기본(추천) 포커스 태그 마스터 테이블.
 *
 * <p>유저 소유 태그({@link FocusTag})와 달리 특정 유저와 FK 관계가 없는 읽기 전용 시드 데이터다.
 * 온보딩/태그 초기 설정 화면에서 occupation 에 맞는 추천 태그를 노출하는 용도이며,
 * 유저가 선택하면 프론트가 {@code POST /api/v1/tag} 로 {@code name} 을 넘겨 실제 태그를 생성한다.
 *
 * <p>어떤 테이블도 이 행을 참조하지 않으므로 소프트 딜리트 컬럼을 두지 않는다
 * (태그 세트 교체는 마이그레이션 시드로 처리).
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

    // FK 아님 — users.occupation 과 동일 값셋(Enum)을 재사용. 저장은 문자열(EnumType.STRING)로 users 와 동일 매핑.
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Occupation occupation;

    @Column(nullable = false)
    private String name;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @CreationTimestamp
    private Instant createdAt;
}
