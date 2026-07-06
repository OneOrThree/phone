package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.OccupationInfo;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * OccupationInfoRepository 통합 테스트.
 *
 * <p>enum @Id(occupations.code) 매핑과 소프트 딜리트 제외 + sort_order 오름차순 조회를
 * 실 PostgreSQL(Testcontainers)로 검증한다. (create-drop 이라 시드 없이 직접 저장해 확인.)
 */
class OccupationInfoRepositoryTest extends RepositoryTestBase {

    @Autowired
    private OccupationInfoRepository occupationInfoRepository;

    @Test
    @DisplayName("findAllByDeletedAtIsNullOrderBySortOrderAsc — 삭제 제외, sort_order 오름차순")
    void findsActiveOrderedBySortOrder() {
        // given: 삽입 순서를 뒤섞고, PATENT_ATTORNEY 는 소프트 딜리트
        occupationInfoRepository.save(OccupationInfo.builder()
                .code(Occupation.UNIVERSITY).displayName("대학생").sortOrder(1).build());
        occupationInfoRepository.save(OccupationInfo.builder()
                .code(Occupation.MIDDLE_SCHOOL).displayName("중학생").sortOrder(0).build());
        occupationInfoRepository.save(OccupationInfo.builder()
                .code(Occupation.PATENT_ATTORNEY).displayName("변리사").sortOrder(4)
                .deletedAt(Instant.now()).build());
        occupationInfoRepository.flush();

        // when
        List<OccupationInfo> result = occupationInfoRepository.findAllByDeletedAtIsNullOrderBySortOrderAsc();

        // then: 삭제된 PATENT_ATTORNEY 제외, sort_order 오름차순(중학생→대학생), enum @Id 왕복 확인
        assertThat(result).extracting(OccupationInfo::getCode)
                .containsExactly(Occupation.MIDDLE_SCHOOL, Occupation.UNIVERSITY);
        assertThat(result).extracting(OccupationInfo::getDisplayName)
                .containsExactly("중학생", "대학생");
    }
}
