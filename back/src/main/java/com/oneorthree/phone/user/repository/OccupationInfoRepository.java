package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.OccupationInfo;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OccupationInfoRepository extends JpaRepository<OccupationInfo, Occupation> {

    /** 삭제되지 않은 occupation 마스터를 code(enum name) 오름차순으로 조회. */
    List<OccupationInfo> findAllByDeletedAtIsNullOrderByCodeAsc();

    // 저장 경로 활성 검증용 (GROMO-626, Codex P2) — soft-deleted occupation 저장 차단
    boolean existsByCodeAndDeletedAtIsNull(Occupation code);
}
