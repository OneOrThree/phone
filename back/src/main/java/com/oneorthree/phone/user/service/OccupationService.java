package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.domain.OccupationInfo;
import com.oneorthree.phone.user.dto.OccupationResponse;
import com.oneorthree.phone.user.repository.OccupationInfoRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class OccupationService {

    private final OccupationInfoRepository occupationInfoRepository;

    /**
     * 삭제되지 않은 occupation 마스터를 노출 순서대로 조회해 DTO 로 매핑.
     * code 는 {@link com.oneorthree.phone.user.domain.Occupation} enum name 문자열.
     */
    public List<OccupationResponse> getOccupations() {
        return occupationInfoRepository.findAllByDeletedAtIsNullOrderBySortOrderAsc().stream()
                .map(OccupationService::toResponse)
                .toList();
    }

    private static OccupationResponse toResponse(OccupationInfo occupation) {
        return new OccupationResponse(
                occupation.getCode().name(),
                occupation.getDisplayName(),
                occupation.getSortOrder());
    }
}
