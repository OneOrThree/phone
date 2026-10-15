package com.oneorthree.phone.user;

import com.oneorthree.phone.user.dto.OccupationResponse;
import com.oneorthree.phone.user.service.OccupationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 직군 마스터 조회 API. 유저 개인 데이터를 다루지 않는 순수 마스터 조회라 인증만 요구하고
 * 호출자별 분기가 없다. OpenAPI 애노테이션은 {@link OccupationControllerDocs} 에 있다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class OccupationController implements OccupationControllerDocs {

    private final OccupationService occupationService;

    /**
     * @return 선택 가능한 직군 목록(200). 폐기(소프트삭제)된 직군은 빠지므로,
     *         <b>기존 유저가 이미 저장해 둔 직군이 이 목록에 없을 수 있다</b>
     */
    @GetMapping("/occupations")
    public ResponseEntity<List<OccupationResponse>> getOccupations() {
        return ResponseEntity.ok(occupationService.getOccupations());
    }
}
