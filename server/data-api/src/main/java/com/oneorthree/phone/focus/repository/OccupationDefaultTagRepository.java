package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.OccupationDefaultTag;
import com.oneorthree.phone.user.repository.domain.Occupation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

/**
 * 직군별 추천 태그 프리셋 — 온보딩에서 직군만 고른 유저에게 보여줄 기본 태그 목록의 원본이다.
 * 여기 담긴 건 <b>추천 후보</b>일 뿐 유저의 채택 태그가 아니다(채택은 {@code user_focus_tags}).
 */
public interface OccupationDefaultTagRepository extends JpaRepository<OccupationDefaultTag, UUID> {

    /**
     * occupation 필터 + sort_order 오름차순 (인덱스 (occupation, sort_order) 활용).
     *
     * <p>GROMO-673: occupation_default_tags 가 default_tags 를 FK 로 참조하도록 바뀌어 이름은 defaultTag 에서
     * 조회한다. 이름 매핑 시 N+1 을 막기 위해 defaultTag 를 fetch join 한다.
     *
     * @param occupation 추천을 받을 직군. 프리셋을 안 깔아둔 직군이면 결과가 빈 목록이다
     * @return 기획이 정한 노출 순서(sortOrder)대로의 프리셋. 이름은 페치된 defaultTag 에서 읽는다
     */
    @Query("SELECT t FROM OccupationDefaultTag t JOIN FETCH t.defaultTag "
            + "WHERE t.occupation = :occupation ORDER BY t.sortOrder ASC")
    List<OccupationDefaultTag> findByOccupationOrderBySortOrderAsc(@Param("occupation") Occupation occupation);
}
