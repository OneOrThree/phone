package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.OccupationInfo;
import com.oneorthree.phone.user.dto.OccupationResponse;
import com.oneorthree.phone.user.repository.OccupationInfoRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 직군 마스터 조회. 유저별 상태가 없는 읽기 전용 서비스다 — 저장 경로의 활성 검증은
 * {@code UserService} 쪽에서 같은 마스터를 다시 확인한다(목록에서 빠진 직군이 저장되면 안 되므로).
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class OccupationService {

    private final OccupationInfoRepository occupationInfoRepository;

    /**
     * 삭제되지 않은 occupation 마스터를 노출 순서대로 조회해 DTO 로 매핑.
     * code 는 {@link Occupation} enum name 문자열.
     *
     * @return 노출 순서대로의 활성 직군. 폐기된 직군은 빠지므로 <b>기존 유저가 가진 값이 없을 수 있다</b>
     */
    public List<OccupationResponse> getOccupations() {
        return occupationInfoRepository.findAllByDeletedAtIsNullOrderByCodeAsc().stream()
                .map(OccupationService::toResponse)
                .toList();
    }

    private static OccupationResponse toResponse(OccupationInfo occupation) {
        return new OccupationResponse(
                occupation.getCode().name(),
                occupation.getDisplayName());
    }
}
