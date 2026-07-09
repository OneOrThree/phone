package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.domain.DefaultTag;
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
 *
 * <p>GROMO-673: occupation_default_tags 가 default_tags 를 FK 로 참조하도록 바뀌어 태그명은 defaultTag 에서
 * 온다. 각 추천 행은 마스터(default_tags) 를 먼저 등록한 뒤 참조한다.
 */
class OccupationDefaultTagRepositoryTest extends RepositoryTestBase {

    @Autowired
    private OccupationDefaultTagRepository occupationDefaultTagRepository;

    @Autowired
    private DefaultTagRepository defaultTagRepository;

    @Test
    @DisplayName("findByOccupationOrderBySortOrderAsc — 지정 occupation 만, sort_order 오름차순, 이름은 defaultTag")
    void findsByOccupationOrderedBySortOrder() {
        // given: 마스터 태그 3건 등록 후 occupation 추천으로 참조
        DefaultTag assignment = defaultTagRepository.save(DefaultTag.builder().name("과제").build());
        DefaultTag major = defaultTagRepository.save(DefaultTag.builder().name("전공 공부").build());
        DefaultTag civilLaw = defaultTagRepository.save(DefaultTag.builder().name("민법").build());

        // UNIVERSITY 태그 2건(삽입 순서 뒤섞음) + 타 occupation(LABOR_ATTORNEY) 1건
        occupationDefaultTagRepository.save(OccupationDefaultTag.builder()
                .occupation(Occupation.UNIVERSITY).defaultTag(assignment).sortOrder(1).build());
        occupationDefaultTagRepository.save(OccupationDefaultTag.builder()
                .occupation(Occupation.UNIVERSITY).defaultTag(major).sortOrder(0).build());
        occupationDefaultTagRepository.save(OccupationDefaultTag.builder()
                .occupation(Occupation.LABOR_ATTORNEY).defaultTag(civilLaw).sortOrder(0).build());
        occupationDefaultTagRepository.flush();

        // when
        List<OccupationDefaultTag> result =
                occupationDefaultTagRepository.findByOccupationOrderBySortOrderAsc(Occupation.UNIVERSITY);

        // then: UNIVERSITY 2건만, sort_order 오름차순(전공 공부→과제), LABOR_ATTORNEY 는 제외
        assertThat(result).extracting(t -> t.getDefaultTag().getName())
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
