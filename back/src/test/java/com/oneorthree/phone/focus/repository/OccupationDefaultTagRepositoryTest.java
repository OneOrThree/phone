package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.domain.OccupationDefaultTag;
import com.oneorthree.phone.user.domain.Occupation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * OccupationDefaultTagRepository.findByOccupationOrderBySortOrderAsc 통합 테스트.
 *
 * <p>occupation 필터 + sort_order 오름차순 정렬, 타 occupation 격리를 실 PostgreSQL(Testcontainers)로 검증한다.
 */
class OccupationDefaultTagRepositoryTest extends RepositoryTestBase {

    @Autowired
    private OccupationDefaultTagRepository occupationDefaultTagRepository;

    @Test
    @DisplayName("findByOccupationOrderBySortOrderAsc — 지정 occupation 만, sort_order 오름차순")
    void findsByOccupationOrderedBySortOrder() {
        // given: UNIVERSITY 태그 2건(삽입 순서 뒤섞음) + 타 occupation(LAWYER) 1건
        occupationDefaultTagRepository.save(OccupationDefaultTag.builder()
                .occupation(Occupation.UNIVERSITY).name("과제").sortOrder(1).build());
        occupationDefaultTagRepository.save(OccupationDefaultTag.builder()
                .occupation(Occupation.UNIVERSITY).name("전공 공부").sortOrder(0).build());
        occupationDefaultTagRepository.save(OccupationDefaultTag.builder()
                .occupation(Occupation.LAWYER).name("민법").sortOrder(0).build());
        occupationDefaultTagRepository.flush();

        // when
        List<OccupationDefaultTag> result =
                occupationDefaultTagRepository.findByOccupationOrderBySortOrderAsc(Occupation.UNIVERSITY);

        // then: UNIVERSITY 2건만, sort_order 오름차순(전공 공부→과제), LAWYER 는 제외
        assertThat(result).extracting(OccupationDefaultTag::getName)
                .containsExactly("전공 공부", "과제");
    }

    @Test
    @DisplayName("findByOccupationOrderBySortOrderAsc — 시드 없는 occupation 은 빈 리스트")
    void returnsEmptyWhenNoSeed() {
        List<OccupationDefaultTag> result =
                occupationDefaultTagRepository.findByOccupationOrderBySortOrderAsc(Occupation.PATENT_ATTORNEY);

        assertThat(result).isEmpty();
    }
}
