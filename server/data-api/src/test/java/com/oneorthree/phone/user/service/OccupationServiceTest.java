package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.OccupationInfo;
import com.oneorthree.phone.user.dto.OccupationResponse;
import com.oneorthree.phone.user.repository.OccupationInfoRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

@ExtendWith(MockitoExtension.class)
class OccupationServiceTest {

    @Mock
    private OccupationInfoRepository occupationInfoRepository;

    @InjectMocks
    private OccupationService occupationService;

    @Test
    @DisplayName("getOccupations — repo 결과를 code=enum name 으로 매핑, 조회 순서 유지")
    void mapsToResponsePreservingOrder() {
        // given: repo 가 code 오름차순으로 이미 정렬해 반환
        given(occupationInfoRepository.findAllByDeletedAtIsNullOrderByCodeAsc())
                .willReturn(List.of(
                        OccupationInfo.builder()
                                .code(Occupation.MIDDLE_SCHOOL).displayName("중학생").build(),
                        OccupationInfo.builder()
                                .code(Occupation.UNIVERSITY).displayName("대학생").build()));

        // when
        List<OccupationResponse> result = occupationService.getOccupations();

        // then: code=enum name, displayName 그대로, 순서 유지
        assertThat(result).containsExactly(
                new OccupationResponse("MIDDLE_SCHOOL", "중학생"),
                new OccupationResponse("UNIVERSITY", "대학생"));
    }

    @Test
    @DisplayName("getOccupations — repo 빈 결과면 빈 리스트")
    void returnsEmptyWhenNoRows() {
        given(occupationInfoRepository.findAllByDeletedAtIsNullOrderByCodeAsc())
                .willReturn(List.of());

        assertThat(occupationService.getOccupations()).isEmpty();
    }
}
