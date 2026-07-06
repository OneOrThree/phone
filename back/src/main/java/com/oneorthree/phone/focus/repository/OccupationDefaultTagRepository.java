package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.OccupationDefaultTag;
import com.oneorthree.phone.user.domain.Occupation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface OccupationDefaultTagRepository extends JpaRepository<OccupationDefaultTag, UUID> {

    // occupation 필터 + sort_order 오름차순 (인덱스 (occupation, sort_order) 활용)
    List<OccupationDefaultTag> findByOccupationOrderBySortOrderAsc(Occupation occupation);
}
