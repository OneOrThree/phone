package com.oneorthree.phone.user;

import com.oneorthree.phone.user.dto.OccupationResponse;
import com.oneorthree.phone.user.service.OccupationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 직군 마스터 조회 API. 유저 개인 데이터를 다루지 않는 순수 마스터 조회라 유저 도메인의 다른
 * 컨트롤러와 달리 문서 면(面) 인터페이스 없이 여기 한 곳에 애노테이션을 둔다.
 */
@Tag(name = "occupation", description = "occupation(직업/신분) 마스터 조회 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class OccupationController {

    private final OccupationService occupationService;

    /**
     * @return 선택 가능한 직군 목록(200). 폐기(소프트삭제)된 직군은 빠지므로,
     *         <b>기존 유저가 이미 저장해 둔 직군이 이 목록에 없을 수 있다</b>
     */
    @Operation(summary = "occupation 목록 조회",
            description = "선택 가능한 occupation(직업/신분) 전역 목록. code(enum name)·표시명·노출 순서를 "
                    + "sort_order 오름차순으로 반환한다. 온보딩 등에서 유저가 고른 code 를 users.occupation 으로 저장.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    @GetMapping("/occupations")
    public ResponseEntity<List<OccupationResponse>> getOccupations() {
        return ResponseEntity.ok(occupationService.getOccupations());
    }
}
