package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.OccupationInfo;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OccupationInfoRepository extends JpaRepository<OccupationInfo, Occupation> {

    /** 삭제되지 않은 occupation 마스터를 노출 순서(sortOrder) 오름차순으로 조회. */
    List<OccupationInfo> findAllByDeletedAtIsNullOrderBySortOrderAsc();
}
