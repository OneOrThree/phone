package com.oneorthree.phone.user;

import com.oneorthree.phone.user.dto.OccupationResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.List;

/**
 * {@code OccupationController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "occupation", description = "occupation(직업/신분) 마스터 조회 API")
public interface OccupationControllerDocs {

    /** @return 선택 가능한 직군 목록 */
    @Operation(summary = "occupation 목록 조회",
            description = "선택 가능한 occupation(직업/신분) 전역 목록. code(enum name)·표시명·노출 순서를 "
                    + "sort_order 오름차순으로 반환한다. 온보딩 등에서 유저가 고른 code 를 users.occupation 으로 저장.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    ResponseEntity<List<OccupationResponse>> getOccupations();
}
