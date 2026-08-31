package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.OccupationDefaultTag;
import com.oneorthree.phone.user.repository.domain.Occupation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface OccupationDefaultTagRepository extends JpaRepository<OccupationDefaultTag, UUID> {

    /**
     * occupation 필터 + sort_order 오름차순 (인덱스 (occupation, sort_order) 활용).
     *
     * <p>GROMO-673: occupation_default_tags 가 default_tags 를 FK 로 참조하도록 바뀌어 이름은 defaultTag 에서
     * 조회한다. 이름 매핑 시 N+1 을 막기 위해 defaultTag 를 fetch join 한다.
     */
    @Query("SELECT t FROM OccupationDefaultTag t JOIN FETCH t.defaultTag "
            + "WHERE t.occupation = :occupation ORDER BY t.sortOrder ASC")
    List<OccupationDefaultTag> findByOccupationOrderBySortOrderAsc(@Param("occupation") Occupation occupation);
}
